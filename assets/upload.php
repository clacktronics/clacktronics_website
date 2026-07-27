<?php
/**
 * ClackOS asset upload endpoint.
 *
 * Accepts one image/video/audio/3D-model file over an authenticated POST and stores it
 * under uploads/YYYY/MM/, returning the public URL as JSON. The Markdown Editor
 * (and other ClackOS apps) call this so large binaries land on the web host and
 * never go through the GitHub repository.
 *
 * SECURITY MODEL (see README "Uploading media"):
 *   - A shared secret token is required on every request. The real token lives
 *     ONLY in upload-config.php on the server (git-ignored, never deployed), so
 *     it is never in the public repository.
 *   - Only an allow-list of image/video/audio types is accepted, and the stored
 *     extension is taken from the file's *sniffed* MIME type, not its name.
 *   - 3D models (STL, STEP, OBJ, 3MF) have no MIME type of their own that finfo
 *     can report, so they are matched on their actual content instead — see
 *     sniff_model(). The filename is still never trusted for anything.
 *   - The uploads directory gets a .htaccess that disables script execution, so
 *     nothing dropped there can ever run, even if it slipped past the allow-list.
 *   - Filenames are generated server-side (date + random), so no path traversal
 *     or overwriting of existing files is possible.
 *
 * This file is public and contains no secrets. All secret/host-specific settings
 * come from upload-config.php next to it (copy upload-config.example.php).
 */

// ---- load server-only config (secret token + optional overrides) -----------
$config = @include __DIR__ . '/upload-config.php';
if (!is_array($config) || empty($config['token'])) {
    send_json(500, ['ok' => false, 'error' => 'Upload endpoint is not configured on the server.']);
}

$TOKEN       = (string) $config['token'];
$ALLOWED     = isset($config['origins']) && is_array($config['origins']) ? $config['origins'] : [];
$MAX_BYTES   = isset($config['max_bytes']) ? (int) $config['max_bytes'] : 104857600; // 100 MB default
$STORE_DIR   = !empty($config['dir'])  ? rtrim((string) $config['dir'], '/')  : __DIR__ . '/uploads';
$PUBLIC_BASE = !empty($config['base']) ? rtrim((string) $config['base'], '/') : null;

// ---- CORS (only needed if the editor is served from another origin) --------
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $ALLOWED, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: X-Upload-Token, Content-Type');
    header('Access-Control-Max-Age: 600');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// The uploaded files are already public website assets. This read-only
// catalogue lets File Manager discover both existing and future uploads
// without a GitHub commit, workflow, or public directory listing.
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' && isset($_GET['list'])) {
    send_upload_catalogue($STORE_DIR, $PUBLIC_BASE !== null ? $PUBLIC_BASE : derive_base());
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    send_json(405, ['ok' => false, 'error' => 'Use POST to upload or GET ?list=1 to list uploaded media.']);
}

// ---- authenticate ----------------------------------------------------------
$given = $_SERVER['HTTP_X_UPLOAD_TOKEN'] ?? ($_POST['token'] ?? '');
if (!is_string($given) || !hash_equals($TOKEN, $given)) {
    send_json(401, ['ok' => false, 'error' => 'Invalid or missing upload token.']);
}

// ---- validate the uploaded file --------------------------------------------
if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
    send_json(400, ['ok' => false, 'error' => 'No file was sent (field name must be "file").']);
}
$file = $_FILES['file'];
if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    send_json(400, ['ok' => false, 'error' => 'Upload failed (' . upload_error_text($file['error'] ?? -1) . ').']);
}
if (!is_uploaded_file($file['tmp_name'])) {
    send_json(400, ['ok' => false, 'error' => 'Bad upload.']);
}
if ($file['size'] > $MAX_BYTES) {
    send_json(413, ['ok' => false, 'error' => 'File is larger than the ' . round($MAX_BYTES / 1048576) . ' MB limit.']);
}

// Allow-list: sniffed MIME type -> stored extension. The client's filename
// extension is ignored; we trust the detected content type only.
$allow = [
    'image/jpeg'      => 'jpg',
    'image/png'       => 'png',
    'image/gif'       => 'gif',
    'image/webp'      => 'webp',
    'image/bmp'       => 'bmp',
    'video/mp4'       => 'mp4',
    'video/webm'      => 'webm',
    'video/quicktime' => 'mov',
    'video/x-matroska'=> 'mkv',
    'video/ogg'       => 'ogv',
    'audio/mpeg'      => 'mp3',
    'audio/wav'       => 'wav',
    'audio/x-wav'     => 'wav',
    'audio/ogg'       => 'ogg',
    'audio/webm'      => 'weba',
];
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime  = $finfo->file($file['tmp_name']) ?: '';
$ext   = $allow[$mime] ?? null;
$kind  = $ext !== null ? explode('/', $mime)[0] : null;   // image | video | audio

// A model sniffs as something generic (octet-stream, text/plain, zip), so it is
// only recognised by its own content signature, and only once the media
// allow-list has already declined the file.
if ($ext === null) {
    $ext = sniff_model($file['tmp_name'], (int) $file['size']);
    if ($ext !== null) $kind = 'model';
}
if ($ext === null) {
    send_json(415, ['ok' => false, 'error' => 'Only images, video, audio and 3D models (STL, STEP, OBJ, 3MF) are accepted (got "' . $mime . '").']);
}

// ---- build a safe, unique destination --------------------------------------
$slug = strtolower(pathinfo($file['name'] ?? '', PATHINFO_FILENAME));
$slug = trim(preg_replace('/[^a-z0-9]+/', '-', $slug), '-');
if (strlen($slug) > 40) $slug = substr($slug, 0, 40);
if ($slug === '')       $slug = 'file';

$sub  = date('Y') . '/' . date('m');
$name = date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '-' . $slug . '.' . $ext;
$dir  = $STORE_DIR . '/' . $sub;

if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
    send_json(500, ['ok' => false, 'error' => 'Could not create the uploads directory.']);
}
harden_uploads_dir($STORE_DIR);

$dest = $dir . '/' . $name;
if (!move_uploaded_file($file['tmp_name'], $dest)) {
    send_json(500, ['ok' => false, 'error' => 'Could not save the file.']);
}
@chmod($dest, 0644);

// ---- report the public URL -------------------------------------------------
$rel = $sub . '/' . $name;
$url = $PUBLIC_BASE !== null ? $PUBLIC_BASE . '/' . $rel : derive_base() . '/' . $rel;

send_json(200, [
    'ok'   => true,
    'url'  => $url,
    'name' => $name,
    'type' => $mime,
    'size' => (int) $file['size'],
    'kind' => $kind, // image | video | audio | model
]);

// ---------------------------------------------------------------------------
/**
 * Identify a 3D model by its contents, returning the extension to store it
 * under, or null when the file is not one. Each format is matched on something
 * only a real file of that format has, so a renamed executable or script fails
 * every test the same way an unknown binary does.
 */
function sniff_model($path, $size) {
    $head = @file_get_contents($path, false, null, 0, 8192);
    if ($head === false || $head === '') return null;

    // Binary STL: 80-byte header, a uint32 triangle count, then exactly 50
    // bytes per triangle — the arithmetic has to come out exactly.
    if ($size > 84) {
        $count = unpack('V', substr($head, 80, 4))[1];
        if ($count > 0 && $size === 84 + $count * 50) return 'stl';
    }

    // 3MF is an OPC (zip) package that must contain a 3dmodel.model part.
    if (strncmp($head, "PK\x03\x04", 4) === 0) {
        if (!class_exists('ZipArchive')) return null;
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) return null;
        $found = $zip->locateName('3dmodel.model', ZipArchive::FL_NOCASE | ZipArchive::FL_NODIR);
        $zip->close();
        return $found !== false ? '3mf' : null;
    }

    // The rest are text formats, so anything with control bytes is out.
    if (preg_match('/[\x00-\x08\x0e-\x1f]/', $head)) return null;
    $text = ltrim($head);
    if (stripos($text, 'ISO-10303-21;') === 0) return 'step';            // STEP
    if (preg_match('/^solid\b/i', $text) && stripos($head, 'facet') !== false) return 'stl';
    if (preg_match('/^v(?:[ \t]+[-+0-9.eE]+){3}[ \t]*$/m', $head)) return 'obj';
    return null;
}

function send_json($status, $payload) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload);
    exit;
}

function derive_base() {
    $https  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $scheme = $https ? 'https' : 'http';
    $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $dir    = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/'));
    $dir    = rtrim($dir, '/');
    return $scheme . '://' . $host . $dir . '/uploads';
}

function send_upload_catalogue($root, $public_base) {
    $kinds = [
        'jpg' => 'image', 'jpeg' => 'image', 'png' => 'image',
        'gif' => 'image', 'webp' => 'image', 'bmp' => 'image',
        'mp4' => 'video', 'webm' => 'video', 'mov' => 'video',
        'mkv' => 'video', 'ogv' => 'video',
        'mp3' => 'audio', 'wav' => 'audio', 'ogg' => 'audio',
        'weba' => 'audio',
        'stl' => 'model', 'step' => 'model', 'stp' => 'model',
        'obj' => 'model', '3mf' => 'model',
    ];
    $files = [];
    if (is_dir($root)) {
        try {
            $iterator = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
            );
            foreach ($iterator as $file) {
                if (!$file->isFile()) continue;
                $extension = strtolower($file->getExtension());
                if (!isset($kinds[$extension])) continue;
                $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
                $url_path = implode('/', array_map('rawurlencode', explode('/', $relative)));
                $files[] = [
                    'name' => $file->getFilename(),
                    'path' => 'Uploads/' . $relative,
                    'url' => rtrim($public_base, '/') . '/' . $url_path,
                    'kind' => $kinds[$extension],
                    'size' => $file->getSize(),
                    'modified' => gmdate('c', $file->getMTime()),
                    'source' => 'Uploaded media',
                ];
            }
        } catch (UnexpectedValueException $error) {
            send_json(500, ['ok' => false, 'error' => 'Could not read the uploads directory.']);
        }
    }
    usort($files, function ($a, $b) {
        return strcmp($b['modified'], $a['modified']);
    });
    send_json(200, [
        'ok' => true,
        'baseUrl' => rtrim($public_base, '/') . '/',
        'files' => $files,
    ]);
}

function harden_uploads_dir($root) {
    $htaccess = $root . '/.htaccess';
    if (is_file($htaccess)) return;
    $rules = <<<HT
# Auto-generated by upload.php — keep uploads inert.
Options -Indexes -ExecCGI
<IfModule mod_php.c>
  php_flag engine off
</IfModule>
<IfModule mod_php7.c>
  php_flag engine off
</IfModule>
<IfModule mod_php5.c>
  php_flag engine off
</IfModule>
<FilesMatch "(?i)\.(php|phtml|php[0-9]|phps|pht|cgi|pl|py|jsp|asp|aspx|sh|htaccess)$">
  <IfModule mod_authz_core.c>
    Require all denied
  </IfModule>
  <IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
  </IfModule>
</FilesMatch>

HT;
    @file_put_contents($htaccess, $rules);
}

function upload_error_text($code) {
    switch ($code) {
        case UPLOAD_ERR_INI_SIZE:
        case UPLOAD_ERR_FORM_SIZE:  return 'file exceeds the server size limit';
        case UPLOAD_ERR_PARTIAL:    return 'the upload was interrupted';
        case UPLOAD_ERR_NO_FILE:    return 'no file';
        case UPLOAD_ERR_NO_TMP_DIR: return 'server has no temp directory';
        case UPLOAD_ERR_CANT_WRITE: return 'server could not write the file';
        default:                    return 'error ' . $code;
    }
}
