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
const User = require("./models/userAuth");
const Message = require("./models/message");
const Conversation = require("./models/message");
const { GetObjectCommand, S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

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
const compressedVideo = async (videoKey) => {
  try {
    // Download video from S3
    const getObjectParams = {
      Bucket: POST_BUCKET,
      Key: videoKey,
    };

    const response = await s3.send(new GetObjectCommand(getObjectParams));

    // Check if Body is present
    if (!response || !response.Body) {
      throw new Error('No Body found in S3 response');
    }

    // Ensure the Body is a buffer or stream for ffmpeg to process
    const stream = response.Body;
    const chunks = [];

    // Collect chunks of the stream into an array
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Convert chunks to a buffer
    const buffer = Buffer.concat(chunks);

    // Define paths for temp files
    const tempInputPath = path.join(os.tmpdir(), `${videoKey}_input.mp4`);
    const tempOutputPath = path.join(os.tmpdir(), `${videoKey}_output.mp4`);

    // Save the video from S3 to a temp file
    fs.writeFileSync(tempInputPath, buffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .videoCodec('libx264')
        .outputOptions('-crf', '28') // Reduce quality to approximately 75%
        .outputOptions('-preset', 'medium') // Balance compression speed and file size
        .videoFilters('scale=iw*0.75:ih*0.75') // Resize video to 75% of original width and height
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

    // Read the compressed video and upload it back to S3
    const compressedVideoBuffer = fs.readFileSync(tempOutputPath);
    const uploadParams = {
      Bucket: POST_BUCKET,
      Key: videoKey, // This will overwrite the original video with the compressed one. Change if necessary.
      Body: compressedVideoBuffer,
      ContentType: 'video/mp4',
    };

    await s3.send(new PutObjectCommand(uploadParams));
    console.log(`Successfully compressed and re-uploaded video with key: ${videoKey}`);

    // Clean up temp files
    fs.unlinkSync(tempInputPath);
    fs.unlinkSync(tempOutputPath);

  } catch (err) {
    console.error(`Error processing video with key ${videoKey}:`, err);
    // Handle or log error as needed
    throw err; // Re-throw to ensure the error is propagated
  }
};


// Main function to process media
// Example usage

function msgid() {
  return Math.floor(100000 + Math.random() * 900000);
}

const fetchMedia = async () => {
  try {
    console.log("Started processing");

    const posts = await Post.find();  // Assuming `Post.find()` is correct

    for (let j = 1728; j < posts.length; j++) {
      console.log(j, posts[j].title, posts[j]._id);
      const medias = posts[j]?.post?.map((d) => ({
        content: d?.content,
        type: d?.type,
        thumbnail: d?.thumbnail
      })) || [];

      // Handle media asynchronously
      await Promise.all(medias.map(async (media) => {
        if (media.type.startsWith("video")) {
          try {
            // Compress the video
            await compressedVideo(media.content);
            if (media.thumbnail) {
              await compressImageFromS3(media.thumbnail);
            }
            console.log(`Compressed video: ${media.content}`);
          } catch (error) {
            console.error(`Error processing video: ${media.content}`, error);
            // Continue processing other media items
          }
        } else if (media.type.startsWith("image")) {
          try {
            // Compress the image
            await compressImageFromS3(media.content);
            console.log(`Compressed image: ${media.content}`);
          } catch (error) {
            console.error(`Error processing image: ${media.content}`, error);
            // Continue processing other media items
          }
        }
      }));
    }

    console.log("Processing ended");

    // Handle conversation creation and messaging
    const grovyoId = "65a666a3e953a4573e6c7ecf";
    const user = await User.findById("6550737ffe8f9dc7614bba5f");
    const grovyo = await User.findById(grovyoId);

    const convs = await Conversation.findOne({
      members: { $all: [user?._id, grovyo._id] },
    });

    const mesId = msgid();

    if (convs) {
      let data = {
        conversationId: convs._id,
        sender: grovyo._id,
        text: `Post Compression Done`,
        mesId,
      };
      const m = new Message(data);
      await m.save();
      console.log("Message sent");
    } else {
      const conv = new Conversation({
        members: [grovyo._id, user._id],
      });
      const savedconv = await conv.save();
      let data = {
        conversationId: conv._id,
        sender: grovyo._id,
        text: `Post Compression Done`,
        mesId,
      };
      await User.updateOne(
        { _id: grovyo._id },
        {
          $addToSet: {
            conversations: savedconv?._id,
          },
        }
      );
      await User.updateOne(
        { _id: user._id },
        {
          $addToSet: {
            conversations: savedconv?._id,
          },
        }
      );

      const m = new Message(data);
      await m.save();
      console.log("Message sent");
    }
  } catch (error) {
    console.error("Error in fetchMedia:", error);
  }
};

// Call the function to fetch and process media
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
// const updateThumbnail = async () => {
//   try {
//     console.log("Start processing");

//     const posts = await Post.find();

//     // Iterate over all posts
//     for (const [postIndex, post] of posts.entries()) {
//       console.log(`Processing post at index ${postIndex}`);

//       // Process each media item
//       await Promise.all(
//         post.post.map(async (d, mediaIndex) => {
//           if (d.type.startsWith("video")) {
//             if (d?.thumbnail) {
//               console.log(`Thumbnail already exists for media at index ${mediaIndex} in post ${postIndex}`);
//             } else {
//               try {
//                 console.log(`Processing video at media index ${mediaIndex} in post ${postIndex}`);
//                 // Extract and set the new thumbnail
//                 const thumbnailToSave = await extractThumbnailFromVideo(d?.content);
//                 d.thumbnail = thumbnailToSave; // This modifies the object within the post.post array
//               } catch (extractError) {
//                 console.error(`Error extracting thumbnail for media index ${mediaIndex} in post ${postIndex}:`, extractError);
//                 // Handle or log extraction error as needed
//               }
//             }
//           }
//         })
//       );

//       // Save the post after all thumbnails have been updated
//       try {
//         await post.save();
//         console.log(`Post at index ${postIndex} saved successfully`);
//       } catch (saveError) {
//         console.error(`Error saving post at index ${postIndex}:`, saveError);
//         // Handle or log save error as needed
//       }
//     }

//     console.log("Done processing all posts");
//   } catch (error) {
//     console.error("Error in updateThumbnail:", error);
//   }
// };

// // Call the function to update thumbnails
// // updateThumbnail();


// async function extractThumbnailFromVideo(key, thumbnailTime = "00:00:02", thumbnailFormat = "png") {
//   try {
//     // 1. Download video from S3
//     const getObjectParams = {
//       Bucket: POST_BUCKET,
//       Key: key,
//     };

//     const { Body } = await s3.send(new GetObjectCommand(getObjectParams));

//     // 2. Define paths for temp files
//     const tempInputPath = path.join(os.tmpdir(), `${key}_input.mp4`);
//     const tempThumbnailPath = path.join(os.tmpdir(), `${key}_thumbnail.${thumbnailFormat}`);

//     // 3. Save the video from S3 to a temp file
//     const writeStream = fs.createWriteStream(tempInputPath);

//     if (Body instanceof require("stream").Readable) {
//       Body.pipe(writeStream);
//     } else {
//       fs.writeFileSync(tempInputPath, Body);
//     }

//     await new Promise((resolve, reject) => {
//       writeStream.on("finish", resolve);
//       writeStream.on("error", reject);
//     });

//     console.log(`Downloaded video to ${tempInputPath}`);

//     // 4. Extract the thumbnail using ffmpeg
//     await new Promise((resolve, reject) => {
//       ffmpeg(tempInputPath)
//         .screenshots({
//           timestamps: [thumbnailTime], // e.g., take the screenshot at 2 seconds
//           filename: path.basename(tempThumbnailPath),
//           folder: path.dirname(tempThumbnailPath),

//         })
//         .on("end", () => {
//           console.log(`Thumbnail created at ${tempThumbnailPath}`);
//           resolve();
//         })
//         .on("error", (err) => {
//           console.error("Error extracting thumbnail:", err);
//           reject(err);
//         });
//     });

//     // 5. Upload the thumbnail back to S3 (optional)
//     const thumbnailBuffer = fs.readFileSync(tempThumbnailPath);
//     const uploadParams = {
//       Bucket: POST_BUCKET,
//       Key: `${key}_thumbnail.${thumbnailFormat}`,
//       Body: thumbnailBuffer,
//       ContentType: `image/${thumbnailFormat}`,
//     };

//     await s3.send(new PutObjectCommand(uploadParams));
//     console.log(`Thumbnail uploaded to thumbnails/${key}_thumbnail.${thumbnailFormat}`);

//     // 6. Clean up temp files
//     fs.unlinkSync(tempInputPath);
//     fs.unlinkSync(tempThumbnailPath);

//     // Return the path or URL of the uploaded thumbnail (or the buffer if needed

//     return (`${key}_thumbnail.${thumbnailFormat}`)
//   } catch (err) {
//     console.error("Error extracting thumbnail:", err);
//     throw err;
//   }
// }
