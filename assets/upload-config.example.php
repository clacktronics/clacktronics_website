<?php
/**
 * TEMPLATE for the upload endpoint's server-only settings.
 *
 * Do NOT put your real token in this file — it is committed to the public repo.
 * Instead, on the web host, copy this to  upload-config.php  (same folder,
 * next to upload.php) and fill in a real token. upload-config.php is
 * git-ignored and excluded from deploys, so it never leaves the server and is
 * never overwritten.
 *
 * Generate a strong token, e.g.:   openssl rand -hex 32
 * Then paste the SAME token into the ClackOS Markdown Editor's upload dialog.
 */

return [
    // REQUIRED — the shared secret. Long and random. Keep it secret.
    'token' => 'PUT-A-LONG-RANDOM-TOKEN-HERE',

    // OPTIONAL — force stable public URLs and a fixed storage directory so
    // links stay valid even while the site is staged under /temp. If you leave
    // these out, uploads land next to this script and the URL is derived from
    // the request (which will include /temp during staging).
    // 'base' => 'https://clacktronics.co.uk/assets/uploads',
    // 'dir'  => '/home/YOURUSER/public_html/assets/uploads',

    // OPTIONAL — extra origins allowed to call this endpoint (CORS). Only needed
    // if the editor is served from a DIFFERENT origin than this script. When the
    // whole site is on purely, it is same-origin and this can stay empty.
    // 'origins' => ['https://clacktronics.github.io'],

    // OPTIONAL — maximum upload size in bytes (default 100 MB). The PHP settings
    // upload_max_filesize / post_max_size still apply and may be lower.
    // 'max_bytes' => 104857600,
];
