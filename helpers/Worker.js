const { AWS_ACCESS_KEY, AWS_SECRET_KEY, BUCKET_REGION } = require("./constants");
const { Worker } = require('bullmq');
const ffmpeg = require('fluent-ffmpeg');
const { GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const AWS = require("aws-sdk");
const path = require('path');
const os = require('os');
const fs = require('fs');

const s3 = new S3Client({
	region: BUCKET_REGION,
	credentials: {
		accessKeyId: "AKIA4MTWHEKLLPIYGX7U",
		secretAccessKey: "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",
	},
});


const worker = new Worker('videoCompressionQueue', async (job) => {
	const { bucket, key } = job.data;

	console.log(bucket, key);
	try {
		// Download the video from S3
		const getObjectParams = {
			Bucket: bucket,
			Key: key,
		};

		console.log(getObjectParams);

		const { Body } = await s3.send(new GetObjectCommand(getObjectParams));

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
				.outputOptions('-crf', '28')
				.outputOptions('-b:v', '1M')
				.outputOptions('-maxrate', '1M')
				.outputOptions('-bufsize', '2M')
				.outputOptions('-b:a', '128k')
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
			Bucket: bucket,
			Key: key,
			Body: compressedBuffer,
			ContentType: 'video/mp4', // Adjust if necessary
		};
		await s3.send(new PutObjectCommand(uploadParams));

		// Clean up
		fs.unlinkSync(tempInputPath);
		fs.unlinkSync(tempOutputPath);
	} catch (error) {
		console.error('Error processing video compression:', error);
		throw error;
	}
}, {
	connection: {
		host: "13.201.106.188",
		port: 6379,
	},
});

worker.on('completed', (job) => {
	console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
	console.error(`Job ${job.id} failed with error ${err.message}`);
});

worker.on('error', (err) => {
	console.error('Worker error:', err);
});


worker.on('completed', (job) => {
	console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
	console.error(`Job ${job.id} failed with error ${err.message}`);
});

worker.on('error', (err) => {
	console.error('Worker error:', err);
});
