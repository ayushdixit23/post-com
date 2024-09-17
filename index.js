const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const cors = require("cors");
const os = require("os");
const cluster = require("cluster");
const http = require("http");
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs');
const path = require("path")
const rateLimit = require("express-rate-limit");
const sharp = require("sharp")

require("dotenv").config();

// Import routes
const postroutes = require("./routes/post");
const { db, port, POST_BUCKET, BUCKET_REGION, AWS_ACCESS_KEY, AWS_SECRET_KEY } = require("./helpers/constants");
const Post = require("./models/post");
const { GetObjectCommand, S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const app = express();

// Middlewares

//rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.use(limiter);
app.use(require("express-status-monitor")());
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));
app.use(morgan("dev"));
app.use(cookieParser());
app.use("/post", postroutes);

// Connect to DB
const connectDB = async () => {
  try {
    mongoose.set("strictQuery", false);
    await mongoose.connect(db, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("DB is connected");
  } catch (err) {
    console.error("DB connection error:", err);
  }
};

const AWS = require("aws-sdk");

const s3 = new S3Client({
  region: BUCKET_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY,
    secretAccessKey: AWS_SECRET_KEY,
  },
});

AWS.config.update({
  accessKeyId: AWS_ACCESS_KEY,
  secretAccessKey: AWS_SECRET_KEY,
  region: BUCKET_REGION,
});

const startServer = () => {
  const PORT = port;
  http.createServer(app).listen(PORT, () => {
    console.log(`Server is running on port ${PORT} (Worker ${process.pid})`);
  });
};

connectDB()
  .then(startServer)
  .catch((err) => console.error(err));

// Helper function to upload compressed media back to S3
const compressedVideo = async (key) => {
  const getObjectParams = {
    Bucket: POST_BUCKET,
    Key: key,
  };

  console.log(getObjectParams);

  const { Body } = await s3.send(new GetObjectCommand(getObjectParams));

  if (!Body) {
    return
  }

  // Define paths for temp files
  const tempInputPath = path.join(os.tmpdir(), `${key}_input.mp4`);
  const tempOutputPath = path.join(os.tmpdir(), `${key}_output.mp4`);

  console.log('Temp paths:', tempInputPath, tempOutputPath);

  // Write the S3 object (Body) to a temp file
  const writeStream = fs.createWriteStream(tempInputPath);

  if (Body instanceof require('stream').Readable) {
    Body.pipe(writeStream);
  } else {
    fs.writeFileSync(tempInputPath, Body);
  }

  // Wait for the stream to finish writing
  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  console.log(`Written ${fs.statSync(tempInputPath).size} bytes to ${tempInputPath}`);

  // Compress the video
  await new Promise((resolve, reject) => {
    ffmpeg(tempInputPath)
      .videoCodec('libx264')
      .outputOptions('-crf', '28') // Reduce quality to approximately 75%
      .outputOptions('-preset', 'medium') // Balance compression speed and file size
      .videoFilters('scale=iw*0.75:ih*0.75')// Resize video to 80% of original width and height
      .outputOptions('-b:v', '1M') // Set video bitrate (optional for fine-tuning)
      .outputOptions('-maxrate', '1M') // Set max bitrate
      .outputOptions('-bufsize', '2M') // Buffer size for rate control
      .outputOptions('-b:a', '128k') // Set audio bitrate
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('end', () => {
        console.log('FFmpeg processing finished.');
        resolve();
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .save(tempOutputPath);
  });

  // Upload the compressed video back to S3
  const compressedBuffer = fs.readFileSync(tempOutputPath);
  const uploadParams = {
    Bucket: POST_BUCKET,
    Key: key,
    Body: compressedBuffer,
    ContentType: 'video/mp4',
  };
  await s3.send(new PutObjectCommand(uploadParams));

  // Clean up
  fs.unlinkSync(tempInputPath);
  fs.unlinkSync(tempOutputPath);

}

// Main function to process media

// Example usage
const fetchMedia = async () => {
  try {
    console.log("started");

    const posts = await Post.find();  // Assuming `Post.find()` is correct

    for (let j = 0; j < posts.length; j++) {
      const medias = posts[j]?.post?.map((d) => ({
        content: d?.content,
        type: d?.type,
        thumbnail: d?.thumbnail
      })) || [];

      // Handle media asynchronously
      await Promise.all(medias.map(async (media) => {
        if (media.type.startsWith("video")) {
          // If you have a compressedVideo function, call it here
          await compressedVideo(media.content);
          if (media.thumbnail) {
            await compressImageFromS3(media.thumbnail)
          }
          console.log(`Compressed video: ${media.content}`);
        } else if (media.type.startsWith("image")) {
          // Compress the image
          await compressImageFromS3(media.content);
          console.log(`Compressed image: ${media.content}`);
        }
      }));
    }

    console.log("ended");
  } catch (error) {
    console.error("Error in fetchMedia:", error);
  }
};

fetchMedia();

async function compressImageFromS3(key) {
  try {
    // Download image from S3
    const getObjectParams = {
      Bucket: POST_BUCKET,
      Key: key,
    };

    const response = await s3.send(new GetObjectCommand(getObjectParams));

    // Check if Body is present
    if (!response || !response.Body) {
      return
    }

    // Ensure the Body is a buffer or stream for sharp to process
    const stream = response.Body;
    const chunks = [];

    // Collect chunks of the stream into an array
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Convert chunks to a buffer
    const buffer = Buffer.concat(chunks);

    // Compress the image using sharp
    const compressedBuffer = await sharp(buffer)
      .resize(800) // Resize the image (change dimensions as needed)
      .toBuffer();

    // Prepare upload parameters for compressed image
    const uploadParams = {
      Bucket: POST_BUCKET,
      Key: key, // This will overwrite the original image with the compressed one. Change if necessary.
      Body: compressedBuffer,
      ContentType: 'image/jpeg', // Update content type based on the image type
    };

    // Upload compressed image back to S3
    await s3.send(new PutObjectCommand(uploadParams));

    console.log(`Successfully compressed and re-uploaded image with key: ${key}`);

    // Return compressed image metadata
  } catch (err) {
    if (err.name === 'NoSuchKey') {
      console.log(`S3 Error: The object with key ${key} does not exist.`);
      return
    } else {
      console.error('Error compressing image:', err.message || err);
    }
    throw err;
  }
}

