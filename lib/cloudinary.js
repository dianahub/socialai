const { v2: cld } = require('cloudinary');

function isConfigured() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

if (isConfigured()) {
  cld.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,
  });
}

// Upload a buffer to Cloudinary. opts: { public_id, overwrite, folder, ... }
// Returns { url, publicId }
function uploadBuffer(buffer, opts = {}) {
  return new Promise((resolve, reject) => {
    cld.uploader.upload_stream(
      { resource_type: 'image', ...opts },
      (err, result) => err
        ? reject(err)
        : resolve({ url: result.secure_url, publicId: result.public_id })
    ).end(buffer);
  });
}

// Delete an asset by its Cloudinary public_id
async function deleteAsset(publicId) {
  return cld.uploader.destroy(publicId);
}

// Fetch a single asset's URL; returns null if it doesn't exist
async function getAssetUrl(publicId) {
  try {
    const r = await cld.api.resource(publicId);
    return r.secure_url;
  } catch {
    return null;
  }
}

// List all resources under a folder prefix; returns [{ url, publicId }]
async function listFolder(prefix) {
  const result = await cld.api.resources({
    type:        'upload',
    prefix,
    max_results: 50,
  });
  return (result.resources || []).map(r => ({ url: r.secure_url, publicId: r.public_id }));
}

module.exports = { isConfigured, uploadBuffer, deleteAsset, getAssetUrl, listFolder };
