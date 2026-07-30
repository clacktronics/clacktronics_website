<?php
/**
 * TEMPLATE for the upload endpoint's server-only settings.
 *
 * Do NOT put your real token in this file — it is committed to the public repo.
 * Instead, on the web host, copy this to  upload-config.php  and fill in a real
 * token. upload-config.php is git-ignored and excluded from deploys, so it never
 * leaves the server and is never overwritten.
 *
 * WHERE TO PUT IT. upload.php looks next to itself first, then in each directory
 * above, four levels up (and at $CLACKOS_UPLOAD_CONFIG if that is set). So:
 *
 *   <web root>/assets/upload-config.php   works, but is tied to this copy of the
 *                                         site — move the site and it is left
 *                                         behind, and uploads stop working.
 *   /home/YOURUSER/upload-config.php      better: above the web root, outside
 *                                         the deployed tree, so it survives
 *                                         moving or restaging the site and is
 *                                         not web-servable at all.
 *
 * Generate a strong token, e.g.:   openssl rand -hex 32
 * Then paste the SAME token into the ClackOS Markdown Editor's upload dialog.
 */

return [
    // REQUIRED — the shared secret. Long and random. Keep it secret.
    'token' => 'PUT-A-LONG-RANDOM-TOKEN-HERE',

    // OPTIONAL — force stable public URLs and a fixed storage directory. If you
    // leave these out, uploads land in an uploads/ folder next to upload.php and
    // the URL is derived from the request, which is what you want now the site is
    // served from the web root. Set them only if you stage the site in a
    // subfolder again, so links keep pointing at the canonical root paths.
    //
    // If you DO set them, they are absolute and do not follow the site: after
    // moving the site, update or remove them, or uploads keep being written into
    // the old location and handed back URLs that no longer serve them.
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
