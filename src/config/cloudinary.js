const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const env = require('./env');

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
});

const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'avif'];
const VIDEO_FORMATS = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];

const isVideoFile = (file) => file.mimetype.startsWith('video/');

const createStorage = (folder, allowedFormats = IMAGE_FORMATS) => {
  return new CloudinaryStorage({
    cloudinary,
    params: {
      folder: `football-store/${folder}`,
      allowed_formats: allowedFormats,
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    },
  });
};

/**
 * Storage that accepts BOTH images and videos and routes each file to the
 * right Cloudinary resource_type. Videos are uploaded untouched (no
 * fetch_format), images keep the usual auto optimisation.
 */
const createMediaStorage = (folder) => {
  return new CloudinaryStorage({
    cloudinary,
    params: (req, file) => {
      if (isVideoFile(file)) {
        return {
          folder: `football-store/${folder}/videos`,
          resource_type: 'video',
          allowed_formats: VIDEO_FORMATS,
        };
      }
      return {
        folder: `football-store/${folder}`,
        resource_type: 'image',
        allowed_formats: IMAGE_FORMATS,
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      };
    },
  });
};

const productUpload = multer({
  storage: createStorage('products'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

/**
 * Used on the product add/edit forms: field "images" for pictures and field
 * "videos" for product videos played on the product details page.
 */
const productMediaUpload = multer({
  storage: createMediaStorage('products'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB — videos need the headroom
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'videos') {
      if (!isVideoFile(file)) return cb(new Error('Only video files are allowed in the video field'), false);
      return cb(null, true);
    }
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('Only image files are allowed'), false);
  },
});

const avatarUpload = multer({
  storage: createStorage('avatars'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

const bannerUpload = multer({
  storage: createStorage('banners'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

/**
 * @param {string} publicId
 * @param {'image'|'video'} resourceType
 */
const deleteImage = async (publicId, resourceType = 'image') => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.error('Cloudinary delete error:', error);
  }
};

const deleteVideo = (publicId) => deleteImage(publicId, 'video');

module.exports = {
  cloudinary,
  productUpload,
  productMediaUpload,
  avatarUpload,
  bannerUpload,
  deleteImage,
  deleteVideo,
};