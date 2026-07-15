// CommonJS helper (this example dir is "type": "commonjs") — loaded
// synchronously by the require hook on any supported Node version.
module.exports.slug = function slug(v) {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};
