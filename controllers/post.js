const Post = require("../models/post");
const User = require("../models/userAuth");
const Community = require("../models/community");
const uuid = require("uuid").v4;
const Topic = require("../models/topic");
const Notification = require("../models/notification");
const { PassThrough } = require('stream');
const sharp = require("sharp");
const Ads = require("../models/Ads");
const Tag = require("../models/Tag");
const Interest = require("../models/Interest");
const mongoose = require("mongoose")
const Message = require("../models/message");
const os = require("os")
const Comment = require("../models/comment")
const NodeCache = require("node-cache");
const myCache = new NodeCache();
const { POST_URL, URL, AWS_ACCESS_KEY, AWS_SECRET_KEY, BUCKET_REGION, POST_BUCKET } = require("../helpers/constants");

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
require("dotenv").config();
const admin = require("../helpers/fireb");

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

const s3multi = new AWS.S3();

const { Queue, Worker } = require("bullmq");

const videoCompressionQueue = new Queue('videoCompressionQueue', {
  connection: {
    host: "13.201.106.188",
    port: 6379,
  },
})
//Mobile App

const compressImage = async (buffer, mimetype) => {
  try {
    const format = mimetype.split('/')[1];
    const optimizedBuffer = await sharp(buffer)
      .toFormat(format, { quality: 80 })
      .toBuffer();
    return optimizedBuffer;
  } catch (error) {
    throw new Error(`Image compression failed: ${error.message}`);
  }
};

const compressVideo = async (buffer, originalName, s3, POST_BUCKET) => {
  try {
    const inputStream = new PassThrough();
    inputStream.end(buffer);

    const outputStream = new PassThrough();

    return new Promise((resolve, reject) => {
      ffmpeg(inputStream)
        .videoCodec('libvpx-vp9')
        .outputOptions('-b:v', '0')
        .outputOptions('-crf', '30')
        .outputOptions('-b:a', '128k')
        .outputOptions('-auto-alt-ref', '1')
        .outputOptions('-lag-in-frames', '25')
        .size('1280x?')
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`Processing: ${progress.percent}% done`);
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(new Error(`Video compression failed: ${err.message}`));
        })
        .on('end', () => {
          console.log('Video compression finished');
        })
        .pipe(outputStream, { end: true });

      resolve(outputStream);
    });
  } catch (error) {
    throw new Error(`Video compression failed: ${error.message}`);
  }
};

//  message Notification ads 

//like a post
exports.likepost = async (req, res) => {
  const { userId, postId } = req.params;
  const user = await User.findById(userId);
  const post = await Post.findById(postId).populate("sender", "fullname");
  if (!post) {
    res.status(400).json({ message: "No post found" });
  } else if (post.likedby.includes(user._id)) {
    try {
      await Post.updateOne(
        { _id: postId },
        { $pull: { likedby: user._id }, $inc: { likes: -1 } }
      );
      await User.updateOne(
        { _id: userId },
        { $pull: { likedposts: post._id } }
      );
      res.status(200).json({ success: true });
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  } else {
    try {
      await Post.updateOne(
        { _id: postId },
        { $push: { likedby: user._id }, $inc: { likes: 1, views: 4 } }
      );
      await User.updateOne(
        { _id: userId },
        { $push: { likedposts: post._id } }
      );

      if (user._id.toString() !== post.sender._id.toString()) {
        const not = new Notification({
          senderId: user._id,
          recId: post.sender,
          text: user.fullname + " liked your post",
        });
        await not.save();
        await User.updateOne(
          { _id: not.recId },
          { $push: { notifications: not._id }, $inc: { notificationscount: 1 } }
        );
        console.log("noti");
      } else if (user._id.toString() === post.sender._id.toString()) {
        null;
        console.log("no noti");
      }
      res.status(200).json({ success: true });
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  }
};

//dislike a post / not interested
exports.dislikepost = async (req, res) => {
  const { userId, postId } = req.params;
  const user = await User.findById(userId);
  const post = await Post.findById(postId);
  if (!post) {
    res.status(400).json({ message: "No post found" });
  }
  try {
    await Post.updateOne(
      { _id: postId },
      { $pull: { dislikedby: user._id }, $inc: { dsilike: 1 } }
    );
    await User.updateOne({ _id: userId }, { $pull: { likedposts: post._id } });
    res.status(200).json({ success: true });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

//delete a post
exports.deletepost = async (req, res) => {
  const { userId, postId } = req.params;
  try {
    const post = await Post.findById(postId).populate("community", "category");
    if (!post) {
      res.status(404).json({ message: "Post not found" });
    } else if (post.sender.toString() !== userId) {
      res.status(400).json({ message: "You can't delete others post" });
    } else {
      await Community.updateOne(
        { _id: post.community },
        { $inc: { totalposts: -1 }, $pull: { posts: post?._id } }
      );
      const int = await Interest.findOne({ title: post.community.category });

      for (let i = 0; i < post.tags?.length; i++) {
        const t = await Tag.findOne({ title: post.tags[i].toLowerCase() });

        if (t) {
          await Tag.updateOne(
            { _id: t._id },
            { $inc: { count: -1 }, $pull: { post: post._id } }
          );
          if (int) {
            await Interest.updateOne(
              { _id: int._id },
              { $inc: { count: -1 }, $pull: { post: post._id, tags: t._id } }
            );
          }
        }
      }
      const topic = await Topic.findOne({
        community: post.community,
        nature: "post",
        title: "Posts",
      });

      if (topic) {
        await Topic.updateOne(
          { _id: topic._id },
          { $pull: { posts: post._id }, $inc: { postcount: -1 } }
        );
      }
      for (let j = 0; j < post.post.length; j++) {
        const result = await s3.send(
          new DeleteObjectCommand({
            Bucket: POST_BUCKET,
            Key: post.post[j].content,
          })
        );
      }

      await Post.findByIdAndDelete(postId);

      res.status(200).json({ success: true });
    }
  } catch (e) {
    console.log(e);
    res.status(404).json({ message: "Something went wrong", success: false });
  }
};

//s3 bucket

//post anything with thumbnail and video
exports.postanythings3 = async (req, res) => {
  try {
    const { parts, index, name } = req.body;
    console.log(parts);
    const formattedParts = parts.map((part, i) => ({
      ETag: part.etag,
      PartNumber: part.partNumber,
    }));

    const params = {
      Bucket: "transcribtio9",
      Key: name,
      UploadId: index,
      MultipartUpload: {
        Parts: formattedParts,
      },
    };

    const uploadId = await s3multi.createMultipartUpload(
      params,
      (err, data) => {
        if (err) {
          console.error("Error completing multipart upload:", err);
          return res.status(500).json({
            message: "Failed to complete multipart upload",
            success: false,
          });
          console.log(data);
        }

        console.log("Multipart upload completed successfully:", data);
        res.status(200).json({ success: true, data });
      }
    );
  } catch (error) {
    console.error("Error in postanythings3 handler:", error);
    res.status(500).json({ message: "Something went wrong", success: false });
  }
};

//new for you
exports.newfetchfeeds3 = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    const dps = [];
    let current = [];
    const memdps = [];
    const subs = [];
    const liked = [];
    const ads = [];
    const urls = [];
    const content = [];
    const addp = [];

    //checking and removing posts with no communities
    // const p = await Post.find();

    // for (let i = 0; i < p.length; i++) {
    //   const com = await Community.findById(p[i].community);
    //   if (!com) {
    //     p[i].remove();
    //   }
    // }

    //getting all related tags
    const intt = await Interest.find({ title: { $in: user.interest } })
      .select("tags")
      .populate("tags", "title")
      .lean()
      .limit(1);

    let alltags = [];
    for (let i = 0; i < intt.length; i++) {
      const interest = intt[i];
      if (interest.tags && interest.tags.length > 0) {
        for (let j = 0; j < interest.tags.length; j++) {
          const tag = interest.tags[j];
          if (tag) {
            const tagsArray = tag.title.split(" ").map((tag) => tag.slice(1));
            alltags = [...alltags, ...tagsArray];
          }
        }
      }
    }

    //fetching post
    const post = await Post.aggregate([
      {
        $lookup: {
          from: "communities",
          localField: "community",
          foreignField: "_id",
          as: "communityInfo",
        },
      },
      {
        $match: {
          $or: [
            { "communityInfo.category": { $in: user.interest } }, // Match community categories
            {
              $or: [{ tags: { $in: alltags } }, { tags: { $exists: false } }],
            },
          ],
        },
      },
      { $sample: { size: 20 } },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "sender",
        },
      },
      {
        $lookup: {
          from: "communities",
          localField: "community",
          foreignField: "_id",
          as: "community",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "community.members",
          foreignField: "_id",
          as: "members",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "community.type",
          foreignField: "_id",
          as: "type",
        },
      },
      {
        $addFields: {
          sender: { $arrayElemAt: ["$sender", 0] },
          community: { $arrayElemAt: ["$community", 0] },
        },
      },
      {
        $addFields: {
          "community.members": {
            $map: {
              input: { $slice: ["$members", 0, 4] },
              as: "member",
              in: {
                _id: "$$member._id",
                fullname: "$$member.fullname",
                profilepic: "$$member.profilepic",
              },
            },
          },
        },
      },
      {
        $match: {
          "community.type": { $eq: "public" }, // Excluding posts with community type other than "public"
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          createdAt: 1,
          status: 1,
          likedby: 1,
          likes: 1,
          dislike: 1,
          comments: 1,
          totalcomments: 1,
          tags: 1,
          view: 1,
          desc: 1,
          isverified: 1,
          post: 1,
          contenttype: 1,
          date: 1,
          sharescount: 1,
          sender: {
            _id: 1,
            fullname: 1,
            profilepic: 1,
          },
          community: {
            _id: 1,
            title: 1,
            dp: 1,
            members: 1,
            memberscount: 1,
            isverified: 1,
            type: 1,
          },
          topicId: 1,
        },
      },
    ]);

    //fetching ads
    const firstad = await Ads.findOne({
      status: "active",
      $or: [{ type: "banner" }],
    })
      .sort({ cpa: -1 })
      .populate({
        path: "postid",
        select:
          "desc post title kind likes likedby comments members community cta ctalink sender totalcomments adtype date createdAt",
        populate: [
          {
            path: "community",
            select: "dp title isverified memberscount members",
            populate: { path: "members", select: "profilepic" },
          },
          { path: "sender", select: "profilepic fullname" },
        ],
      })
      .limit(1);

    const infeedad = await Ads.find({
      status: "active",
      $or: [{ type: "infeed" }],
    }).populate({
      path: "postid",
      select:
        "desc post title kind likes comments community cta ctalink likedby sender totalcomments adtype date createdAt",
      populate: [
        {
          path: "community",
          select: "dp title isverified memberscount members",
          populate: { path: "members", select: "profilepic" },
        },
        { path: "sender", select: "profilepic fullname" },
      ],
    });

    function getRandomIndex() {
      const min = 6;
      return min + Math.floor(Math.random() * (post.length - min));
    }

    let feedad = [];
    for (let i = 0; i < infeedad.length; i++) {
      feedad.push(infeedad[i].postid);
    }

    //merging ads
    if (firstad) {
      post.unshift(firstad.postid);
    }

    if (
      feedad?.length > 0 &&
      (!feedad.includes(null) || !feedad.includes("null"))
    ) {
      for (let i = 0; i < feedad.length; i++) {
        const randomIndex = getRandomIndex();
        post.splice(randomIndex, 0, feedad[i]);
      }
    }

    for (let i = 0; i < post.length; i++) {
      if (
        post[i].likedby?.some((id) => id.toString() === user._id.toString())
      ) {
        liked.push(true);
      } else {
        liked.push(false);
      }
    }

    for (let k = 0; k < post.length; k++) {
      const coms = await Community.findById(post[k].community);

      if (coms?.members?.includes(user._id)) {
        subs.push("subscribed");
      } else {
        subs.push("unsubscribed");
      }
    }

    if (!post) {
      res.status(201).json({ message: "No post found", success: false });
    } else {
      //post
      for (let i = 0; i < post.length; i++) {
        const a = URL + post[i].community.dp;
        dps.push(a);
      }

      let ur = [];
      for (let i = 0; i < post?.length; i++) {
        for (let j = 0; j < post[i]?.post?.length; j++) {
          if (post[i].post[j].thumbnail) {
            const a =
              post[i].post[j].link === true
                ? POST_URL + post[i].post[j].content + "640.mp4"
                : POST_URL + post[i].post[j].content;
            const t = POST_URL + post[i].post[j].thumbnail;

            ur.push({ content: a, thumbnail: t, type: post[i].post[j]?.type });
          } else {
            const a = POST_URL + post[i].post[j].content;
            ur.push({ content: a, type: post[i].post[j]?.type });
          }
        }
        urls.push(ur);
        ur = [];
      }

      for (let i = 0; i < post.length; i++) {
        for (
          let j = 0;
          j < Math.min(4, post[i].community.members.length);
          j++
        ) {
          const a =
            URL + post[i]?.community?.members[j]?.profilepic;
          current.push(a);
        }

        memdps.push(current);
        current = [];
      }

      //post data
      const dpData = dps;
      const memdpData = memdps;
      const urlData = urls;
      const postData = post;
      const subData = subs;
      const likeData = liked;

      const mergedData = urlData.map((u, i) => ({
        dps: dpData[i],
        memdps: memdpData[i],
        urls: u,
        liked: likeData[i],
        subs: subData[i],
        posts: postData[i],
      }));

      res.status(200).json({
        mergedData,
        success: true,
      });
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: err, success: false });
  }
};

//community feed
exports.joinedcomnews3 = async (req, res) => {
  const { userId } = req.params;
  const user = await User.findById(userId);

  try {
    const communities = await Community.find({
      members: { $in: user._id },
    })
      .populate("members", "profilepic")
      .populate("creator", "fullname")
      .populate("topics", "title nature");

    const ownedcoms = await Community.find({ creator: user._id.toString() });

    if (!communities || communities.length === 0) {
      res.status(200).json({ message: "No communities found", success: true });
      return;
    }

    let topic = [];
    const dps = [];
    const urls = [];
    const posts = [];
    const liked = [];
    let current = [];
    const memdps = [];

    // Sort communities based on whether they have a post and the latest post first
    communities.sort((a, b) => {
      const postA = a.posts.length > 0 ? a.posts[0].createdAt : 0;
      const postB = b.posts.length > 0 ? b.posts[0].createdAt : 0;
      return postB - postA;
    });

    for (const community of communities) {
      let nontopic = [];
      for (let i = 0; i < community.topics.length; i++) {
        const msg = await Message.countDocuments({
          topicId: community.topics[i],
          readby: { $nin: [user._id], $exists: true },
        });

        let d = {
          title: community.topics[i]?.title,
          _id: community.topics[i]?._id,
          msg,
          nature: community.topics[i]?.nature,
          index: i,
        };
        nontopic.push(d);
      }
      topic.push(nontopic);
      const post = await Post.find({
        community: community._id,
        type: "Post",
      })
        .populate("sender", "fullname")
        .sort({ createdAt: -1 })
        .limit(1);
      posts.push(post);

      for (let j = 0; j < Math.min(4, community.members.length); j++) {
        const a = URL + community.members[j].profilepic;

        current.push(a);
      }

      memdps.push(current);
      current = [];

      if (post.length > 0) {
        const like = post[0]?.likedby?.includes(user._id);
        liked.push(like);
      } else {
        liked.push(false);
      }

      let ur = [];
      for (let j = 0; j < post[0]?.post?.length; j++) {
        if (post[0].post[j].thumbnail) {
          const a =
            post[0].post[j].link === true
              ? POST_URL + post[0].post[j].content + "640.mp4"
              : POST_URL + post[0].post[j].content;
          const t = POST_URL + post[0].post[j].thumbnail;

          ur.push({ content: a, thumbnail: t, type: post[0].post[j]?.type });
        } else {
          const a = POST_URL + post[0].post[j].content;

          ur.push({ content: a, type: post[0].post[j]?.type });
        }
      }

      urls.push(ur);
      const a = URL + community.dp;

      dps.push(a);
    }

    const dpData = dps;
    const memdpData = memdps;
    const urlData = urls;
    const postData = posts;
    const communityData = communities;
    const likeData = liked;

    const mergedData = communityData.map((c, i) => ({
      dps: dpData[i],
      memdps: memdpData[i],
      urls: urlData[i],
      liked: likeData[i],
      community: c,
      posts: postData[i],
      topics: topic[i],
    }));

    //arrange acc ot latest post first
    mergedData.sort((a, b) => {
      const timeA = a?.posts[0]?.createdAt || 0;
      const timeB = b?.posts[0]?.createdAt || 0;

      return timeB - timeA;
    });

    res.status(200).json({
      mergedData,
      success: true,
      cancreate: ownedcoms?.length >= 2 ? false : true,
    });
  } catch (e) {
    console.log(e);
    res.status(400).json({ message: e.message, success: false });
  }
};

//fetching the interests
exports.fetchinterest = async (req, res) => {
  try {
    // const interest = await Interest.find({ count: 0 });
    const interest = await Interest.find({ count: { $gt: 0 } });

    let finals = [];
    let dps = [];
    for (let i = 0; i < interest.length; i++) {
      finals.push(interest[i].title);
      let a = URL + interest[i].pic + ".png";

      dps.push(a);
    }
    let merged = finals.map((f, i) => ({
      f,
      dp: dps[i],
    }));

    res.status(200).json({ success: true, interests: merged });
  } catch (e) {
    console.log(e);
    res.status(400).json({ message: e.message, success: false });
  }
};

//fetch more data
exports.fetchmoredata = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    const dps = [];
    let current = [];
    const memdps = [];
    const subs = [];
    const liked = [];
    const ads = [];
    const urls = [];
    const content = [];
    const addp = [];

    //checking and removing posts with no communities
    // const p = await Post.find();

    // for (let i = 0; i < p.length; i++) {
    //   const com = await Community.findById(p[i].community);
    //   if (!com) {
    //     p[i].remove();
    //   }
    // }

    //fetching post
    const post = await Post.aggregate([
      {
        $lookup: {
          from: "communities",
          localField: "community",
          foreignField: "_id",
          as: "communityInfo",
        },
      },
      {
        $match: {
          "communityInfo.category": { $in: user.interest },
        },
      },
      { $sample: { size: 10 } },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "sender",
        },
      },
      {
        $lookup: {
          from: "communities",
          localField: "community",
          foreignField: "_id",
          as: "community",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "community.members",
          foreignField: "_id",
          as: "members",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "community.type",
          foreignField: "_id",
          as: "type",
        },
      },
      {
        $addFields: {
          sender: { $arrayElemAt: ["$sender", 0] },
          community: { $arrayElemAt: ["$community", 0] },
        },
      },
      {
        $addFields: {
          "community.members": {
            $map: {
              input: { $slice: ["$members", 0, 4] },
              as: "member",
              in: {
                _id: "$$member._id",
                fullname: "$$member.fullname",
                profilepic: "$$member.profilepic",
              },
            },
          },
        },
      },
      {
        $match: {
          "community.type": { $eq: "public" }, // Excluding posts with community type other than "public"
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          createdAt: 1,
          status: 1,
          likedby: 1,
          likes: 1,
          dislike: 1,
          comments: 1,
          totalcomments: 1,
          tags: 1,
          view: 1,
          desc: 1,
          isverified: 1,
          post: 1,
          contenttype: 1,
          date: 1,
          sharescount: 1,
          sender: {
            _id: 1,
            fullname: 1,
            profilepic: 1,
          },
          community: {
            _id: 1,
            title: 1,
            dp: 1,
            members: 1,
            memberscount: 1,
            isverified: 1,
            type: 1,
          },
          topicId: 1,
        },
      },
    ]);

    //fetching ads
    const firstad = await Ads.findOne({
      status: "active",
      $or: [{ type: "banner" }],
    })
      .populate({
        path: "postid",
        select:
          "desc post title kind likes likedby comments members community cta ctalink sender totalcomments adtype date createdAt",
        populate: [
          {
            path: "community",
            select: "dp title isverified memberscount members",
            populate: { path: "members", select: "profilepic" },
          },
          { path: "sender", select: "profilepic fullname" },
        ],
      })
      .limit(1);

    const infeedad = await Ads.find({
      status: "active",
      $or: [{ type: "infeed" }],
    }).populate({
      path: "postid",
      select:
        "desc post title kind likes comments community cta ctalink likedby sender totalcomments adtype date createdAt",
      populate: [
        {
          path: "community",
          select: "dp title isverified memberscount members",
          populate: { path: "members", select: "profilepic" },
        },
        { path: "sender", select: "profilepic fullname" },
      ],
    });

    function getRandomIndex() {
      const min = 6;
      return min + Math.floor(Math.random() * (post.length - min));
    }

    let feedad = [];
    for (let i = 0; i < infeedad.length; i++) {
      feedad.push(infeedad[i].postid);
    }

    //merging ads
    if (firstad) {
      post.unshift(firstad.postid);
    }

    if (
      feedad?.length > 0 &&
      (!feedad.includes(null) || !feedad.includes("null"))
    ) {
      for (let i = 0; i < feedad.length; i++) {
        const randomIndex = getRandomIndex();
        post.splice(randomIndex, 0, feedad[i]);
      }
    }

    for (let i = 0; i < post.length; i++) {
      if (
        post[i].likedby?.some((id) => id.toString() === user._id.toString())
      ) {
        liked.push(true);
      } else {
        liked.push(false);
      }
    }

    for (let k = 0; k < post.length; k++) {
      const coms = await Community.findById(post[k].community);

      if (coms?.members?.includes(user._id)) {
        subs.push("subscribed");
      } else {
        subs.push("unsubscribed");
      }
    }

    if (!post) {
      res.status(201).json({ message: "No post found", success: false });
    } else {
      //post
      for (let i = 0; i < post.length; i++) {
        const a = URL + post[i].community.dp;
        dps.push(a);
      }

      let ur = [];
      for (let i = 0; i < post?.length; i++) {
        for (let j = 0; j < post[i]?.post?.length; j++) {
          if (post[i].post[j].thumbnail) {
            const a =
              post[i].post[j].link === true
                ? POST_URL + post[i].post[j].content + "640.mp4"
                : POST_URL + post[i].post[j].content;
            const t = POST_URL + post[i].post[j].thumbnail;

            ur.push({ content: a, thumbnail: t, type: post[i].post[j]?.type });
          } else {
            const a = POST_URL + post[i].post[j].content;
            ur.push({ content: a, type: post[i].post[j]?.type });
          }
        }
        urls.push(ur);
        ur = [];
      }

      for (let i = 0; i < post.length; i++) {
        for (
          let j = 0;
          j < Math.min(4, post[i].community.members.length);
          j++
        ) {
          const a =
            URL + post[i]?.community?.members[j]?.profilepic;
          current.push(a);
        }

        memdps.push(current);
        current = [];
      }

      //post data
      const dpData = dps;
      const memdpData = memdps;
      const urlData = urls;
      const postData = post;
      const subData = subs;
      const likeData = liked;

      const mergedData = urlData.map((u, i) => ({
        dps: dpData[i],
        memdps: memdpData[i],
        urls: u,
        liked: likeData[i],
        subs: subData[i],
        posts: postData[i],
      }));

      res.status(200).json({
        mergedData,
        success: true,
      });
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: err, success: false });
  }
};

//Workspace post
// exports.postanythings3workspace = async (req, res) => {
//   const { userId, comId } = req.params;

//   try {
//     if (req.fileValidationError) {
//       return res.status(400).json({
//         message: "File size limit exceeded",
//         success: false,
//       });
//     }

//     const { title, desc, tags, category, topicId, thumbnail } = req.body;
//     const tagArray = tags.split(",");

//     const user = await User.findById(userId);
//     const community = await Community.findById(comId);

//     let topic;
//     if (topicId && topicId !== "undefined") {
//       topic = await Topic.findById(topicId);
//     } else {
//       topic = await Topic.findById(community.topics[0].toString());
//     }

//     if (user && community && topic && req.files.length > 0) {
//       let pos = [];
//       if (thumbnail === "true") {
//         let thumbnailImage = "";
//         let video = "";

//         for (const file of req.files) {
//           const uuidString = uuid();
//           const objectName = `${Date.now()}${uuidString}${file.originalname}`;

//           await s3.send(
//             new PutObjectCommand({
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               Body: file.buffer,
//               ContentType: file.mimetype,
//             })
//           );

//           if (file.fieldname === "thumbnailImage") {
//             thumbnailImage = objectName;
//           } else {
//             video = objectName;
//           }
//         }
//         pos.push({
//           content: video,
//           thumbnail: thumbnailImage,
//           type: "video/mp4",
//         });
//       } else {
//         for (const file of req.files) {
//           const uuidString = uuid();
//           const objectName = `${Date.now()}${uuidString}${file.originalname}`;

//           await s3.send(
//             new PutObjectCommand({
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               Body: file.buffer,
//               ContentType: file.mimetype,
//             })
//           );

//           pos.push({ content: objectName, type: file.mimetype });
//         }
//       }

//       const post = new Post({
//         title,
//         desc,
//         community: comId,
//         sender: userId,
//         post: pos,
//         tags: tagArray,
//         topicId: topic._id,
//       });

//       const savedPost = await post.save();
//       const interest = await Interest.findOne({ title: category });

//       for (const tag of tagArray) {
//         const existingTag = await Tag.findOne({ title: tag.toLowerCase() });

//         if (existingTag) {
//           await Tag.updateOne(
//             { _id: existingTag._id },
//             { $inc: { count: 1 }, $addToSet: { post: post._id } }
//           );

//           if (interest) {
//             await Interest.updateOne(
//               { _id: interest._id },
//               {
//                 $inc: { count: 1 },
//                 $addToSet: { post: post._id, tags: existingTag._id },
//               }
//             );
//           }
//         } else {
//           const newTag = new Tag({
//             title: tag.toLowerCase(),
//             post: post._id,
//             count: 1,
//           });
//           await newTag.save();

//           if (interest) {
//             await Interest.updateOne(
//               { _id: interest._id },
//               {
//                 $inc: { count: 1 },
//                 $addToSet: { post: post._id, tags: newTag._id },
//               }
//             );
//           }
//         }
//       }

//       await Community.updateOne(
//         { _id: comId },
//         { $push: { posts: savedPost._id }, $inc: { totalposts: 1 } }
//       );

//       await Topic.updateOne(
//         { _id: topic._id },
//         { $push: { posts: savedPost._id }, $inc: { postcount: 1 } }
//       );

//       let tokens = [];

//       for (const memberId of community.members) {
//         const member = await User.findById(memberId);

//         if (member.notificationtoken && member._id.toString() !== userId) {
//           tokens.push(member.notificationtoken);
//         }
//       }

//       if (tokens.length > 0) {
//         const msg = {
//           notification: {
//             title: `${community.title} - Posted!`,
//             body: `${savedPost.title}`,
//           },
//           data: {
//             screen: "CommunityChat",
//             sender_fullname: user.fullname,
//             sender_id: user._id.toString(),
//             text: savedPost.title,
//             comId: community._id.toString(),
//             createdAt: new Date().toISOString(),
//             type: "post",
//             link: `${POST_URL}${savedPost.post[0].content}`,
//             comdp: `${URL}${community.dp}`,
//           },
//           tokens: tokens,
//         };

//         await admin.messaging().sendMulticast(msg);
//       }

//       res.status(200).json({ savedPost, success: true });
//     } else {
//       res.status(404).json({
//         message: "User, Community, Topic not found, or no files were uploaded!",
//         success: false,
//       });
//     }
//   } catch (e) {
//     console.log(e);
//     res.status(500).json({ message: "Something went wrong", success: false });
//   }
// };

// Assuming s3multi is an instance of AWS S3



//testing - video compression
// async function compressVideo(filePath) {
//   try {
//     new ffmpeg({ source: filePath })
//       .withSize("640x?")
//       .on("error", function (err) {
//         console.log("An error occurred: " + err.message);
//       })
//       .on("end", function () {
//         console.log("Processing finished!");
//       })
//       .saveToFile("output.mp4");
//   } catch (e) {
//     console.log(e.code);
//     console.log(e.msg);
//   }
// }

// compressVideo("f.mp4");

//Workspace

//remove community along posts
exports.removecomwithposts = async (req, res) => {
  try {
    const { id, comId } = req.params;
    const user = await User.findById(id);
    if (user) {
      const community = await Community.findById(comId);
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: community.dp,
      });
      if (community) {
        for (let i = 0; i < community.posts.length; i++) {
          const post = await Post.findById(community.posts[i]);
          if (post) {
            for (let j = 0; j < post.post.length; j++) {
              const result = await s3.send(
                new DeleteObjectCommand({
                  Bucket: POST_BUCKET,
                  Key: post.post[j].content,
                })
              );
            }
            post.remove();
          }
        }
        //remove all topics of community
        const topics = await Topic.find({ community: community._id });
        if (topics?.length > 0) {
          for (let i = 0; i < topics.length; i++) {
            await User.findByIdAndUpdate(
              { _id: user._id },
              { $pull: { topicsjoined: topics[i]._id } }
            );
            topics[i].remove();
          }
        }

        await User.findByIdAndUpdate(
          { _id: user._id },
          {
            $pull: {
              communityjoined: community?._id,
              communitycreated: community?._id,
            },
            $inc: { totaltopics: -topics?.length, totalcom: 1 },
          }
        );

        community.remove();
      }
      res.status(200).json({ success: true });
    } else {
      res.status(404).json({ message: "User not found!", success: false });
    }
  } catch (e) {
    console.log(e);
    res.status(400).json({ message: "Something went wrong", success: false });
  }
};

//edit post
// exports.editPosts = async (req, res) => {
//   try {
//     const { userId, postId } = req.params;
//     if (req.fileValidationError) {
//       return res.status(400).json({
//         message: "File size limit exceeded",
//         success: false,
//       });
//     }
//     const { title, desc, tags, image, video, thumbnail, thumbnailImage } =
//       req.body;

//     console.log(req.body, req.files);

//     if (thumbnail == "false") {
//       let videoArr;
//       if (typeof video == "string") {
//         videoArr = [video];
//       } else {
//         videoArr = video || [];
//       }

//       let imageArr;
//       if (typeof image == "string") {
//         imageArr = [image];
//       } else {
//         imageArr = image || [];
//       }
//       let pos = [];
//       let img = [];
//       let vid = [];
//       for (let i = 0; i < imageArr.length; i++) {
//         const s = imageArr[i].split(".net/").pop();
//         img.push(s);
//       }
//       for (let i = 0; i < videoArr.length; i++) {
//         const s = videoArr[i].split(".net/").pop();
//         vid.push(s);
//       }

//       if (req.files && req.files.length > 0) {
//         for (let i = 0; i < req?.files?.length; i++) {
//           const uuidString = uuid();

//           const objectName = `${Date.now()}${uuidString}${req.files[i].originalname
//             }`;
//           const objectId = mongoose.Types.ObjectId();
//           const result = await s3.send(
//             new PutObjectCommand({
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               Body: req.files[i].buffer,
//               ContentType: req.files[i].mimetype,
//             })
//           );

//           pos.push({
//             content: objectName,
//             type: req.files[i].mimetype,
//             _id: objectId,
//           });
//         }
//       }
//       const post = await Post.findById(postId);
//       for (let i = 0; i < post.post.length; i++) {
//         if (post.post[i].type.startsWith("video")) {
//           for (let j = 0; j < vid.length; j++) {
//             if (vid[j] == post.post[i].content) {
//               pos.push(post.post[i]);
//             }
//           }
//         } else if (post.post[i].type.startsWith("image")) {
//           for (let j = 0; j < img.length; j++) {
//             if (img[j] == post.post[i].content) {
//               pos.push(post.post[i]);
//             }
//           }
//         }
//       }
//       post.title = title;
//       post.desc = desc;
//       post.tags = tags;
//       post.post = pos;
//       await post.save();

//       res.status(200).json({ success: true });
//     } else {
//       let myVideo;
//       if (typeof video == "string") {
//         myVideo = video.split(".net/").pop();
//       }
//       let myThumbnail;
//       if (typeof thumbnailImage == "string") {
//         myThumbnail = thumbnailImage.split(".net/").pop();
//       }
//       if (req.files && req.files.length > 0) {
//         for (let i = 0; i < req?.files?.length; i++) {
//           const uuidString = uuid();

//           const objectName = `${Date.now()}${uuidString}${req.files[i].originalname
//             }`;

//           const result = await s3.send(
//             new PutObjectCommand({
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               Body: req.files[i].buffer,
//               ContentType: req.files[i].mimetype,
//             })
//           );

//           if (req.files[i].fieldname === "thumbnailImage") {
//             myThumbnail = objectName;
//           } else {
//             myVideo = objectName;
//           }
//         }
//       }
//       const post = await Post.findById(postId);
//       post.post = [
//         {
//           content: myVideo,
//           type: "video/mp4",
//           thumbnail: myThumbnail,
//         },
//       ];
//       post.title = title;
//       post.desc = desc;
//       post.tags = tags;
//       await post.save();

//       res.status(200).json({ success: true });
//     }
//   } catch (error) {
//     console.log(error);
//     res.status(409).json({
//       message: error.message,
//       success: false,
//     });
//   }
// };

exports.editPosts = async (req, res) => {
  try {
    const { userId, postId } = req.params;
    if (req.fileValidationError) {
      return res.status(400).json({
        message: "File size limit exceeded",
        success: false,
      });
    }
    const { title, desc, tags, image, video, thumbnail, thumbnailImage } = req.body;

    console.log(req.body, req.files);

    if (thumbnail == "false") {
      let videoArr;
      if (typeof video == "string") {
        videoArr = [video];
      } else {
        videoArr = video || [];
      }

      let imageArr;
      if (typeof image == "string") {
        imageArr = [image];
      } else {
        imageArr = image || [];
      }
      let pos = [];
      let img = [];
      let vid = [];
      for (let i = 0; i < imageArr.length; i++) {
        const s = imageArr[i].split(".net/").pop();
        img.push(s);
      }
      for (let i = 0; i < videoArr.length; i++) {
        const s = videoArr[i].split(".net/").pop();
        vid.push(s);
      }

      if (req.files && req.files.length > 0) {
        for (let i = 0; i < req?.files?.length; i++) {
          const uuidString = uuid();
          const objectName = `${Date.now()}${uuidString}${req.files[i].originalname}`;
          const objectId = new mongoose.Types.ObjectId();

          if (req.files[i].size <= 5 * 1024 * 1024) { // If the file size is less than or equal to 5MB
            // Use a simple put object operation
            await s3.send(
              new PutObjectCommand({
                Bucket: POST_BUCKET,
                Key: objectName,
                Body: req.files[i].buffer,
                ContentType: req.files[i].mimetype,
              })
            );
          } else {
            // Multipart upload
            const startParams = {
              Bucket: POST_BUCKET,
              Key: objectName,
              ContentType: req.files[i].mimetype,
            };
            const multipart = await s3.send(new CreateMultipartUploadCommand(startParams));
            const uploadId = multipart.UploadId;
            const partSize = 5 * 1024 * 1024; // 5MB
            const partNumbers = Math.ceil(req.files[i].buffer.length / partSize);
            let parts = [];

            for (let partNumber = 1; partNumber <= partNumbers; partNumber++) {
              const start = (partNumber - 1) * partSize;
              const end = Math.min(start + partSize, req.files[i].buffer.length);
              const partParams = {
                Bucket: POST_BUCKET,
                Key: objectName,
                PartNumber: partNumber,
                UploadId: uploadId,
                Body: req.files[i].buffer.slice(start, end),
              };

              const uploadPart = await s3.send(new UploadPartCommand(partParams));
              parts.push({
                ETag: uploadPart.ETag,
                PartNumber: partNumber,
              });
            }

            const completeParams = {
              Bucket: POST_BUCKET,
              Key: objectName,
              UploadId: uploadId,
              MultipartUpload: { Parts: parts },
            };
            await s3.send(new CompleteMultipartUploadCommand(completeParams));
          }

          pos.push({
            content: objectName,
            type: req.files[i].mimetype,
            _id: objectId,
          });
        }
      }
      const post = await Post.findById(postId);
      for (let i = 0; i < post.post.length; i++) {
        if (post.post[i].type.startsWith("video")) {
          for (let j = 0; j < vid.length; j++) {
            if (vid[j] == post.post[i].content) {
              pos.push(post.post[i]);
            }
          }
        } else if (post.post[i].type.startsWith("image")) {
          for (let j = 0; j < img.length; j++) {
            if (img[j] == post.post[i].content) {
              pos.push(post.post[i]);
            }
          }
        }
      }
      post.title = title;
      post.desc = desc;
      post.tags = tags;
      post.post = pos;
      await post.save();

      res.status(200).json({ success: true });
    } else {
      let myVideo;
      if (typeof video == "string") {
        myVideo = video.split(".net/").pop();
      }
      let myThumbnail;
      if (typeof thumbnailImage == "string") {
        myThumbnail = thumbnailImage.split(".net/").pop();
      }
      if (req.files && req.files.length > 0) {
        for (let i = 0; i < req?.files?.length; i++) {
          const uuidString = uuid();
          const objectName = `${Date.now()}${uuidString}${req.files[i].originalname}`;

          if (req.files[i].size <= 5 * 1024 * 1024) { // If the file size is less than or equal to 5MB
            // Use a simple put object operation
            await s3.send(
              new PutObjectCommand({
                Bucket: POST_BUCKET,
                Key: objectName,
                Body: req.files[i].buffer,
                ContentType: req.files[i].mimetype,
              })
            );
          } else {
            // Multipart upload
            const startParams = {
              Bucket: POST_BUCKET,
              Key: objectName,
              ContentType: req.files[i].mimetype,
            };
            const multipart = await s3.send(new CreateMultipartUploadCommand(startParams));
            const uploadId = multipart.UploadId;
            const partSize = 5 * 1024 * 1024; // 5MB
            const partNumbers = Math.ceil(req.files[i].buffer.length / partSize);
            let parts = [];

            for (let partNumber = 1; partNumber <= partNumbers; partNumber++) {
              const start = (partNumber - 1) * partSize;
              const end = Math.min(start + partSize, req.files[i].buffer.length);
              const partParams = {
                Bucket: POST_BUCKET,
                Key: objectName,
                PartNumber: partNumber,
                UploadId: uploadId,
                Body: req.files[i].buffer.slice(start, end),
              };

              const uploadPart = await s3.send(new UploadPartCommand(partParams));
              parts.push({
                ETag: uploadPart.ETag,
                PartNumber: partNumber,
              });
            }

            const completeParams = {
              Bucket: POST_BUCKET,
              Key: objectName,
              UploadId: uploadId,
              MultipartUpload: { Parts: parts },
            };
            await s3.send(new CompleteMultipartUploadCommand(completeParams));
          }

          if (req.files[i].fieldname === "thumbnailImage") {
            myThumbnail = objectName;
          } else {
            myVideo = objectName;
          }
        }
      }
      const post = await Post.findById(postId);
      post.post = [
        {
          content: myVideo,
          type: "video/mp4",
          thumbnail: myThumbnail,
        },
      ];
      post.title = title;
      post.desc = desc;
      post.tags = tags;
      await post.save();

      res.status(200).json({ success: true });
    }
  } catch (error) {
    console.log(error);
    res.status(409).json({
      message: error.message,
      success: false,
    });
  }
};

//get all post
exports.getallposts = async (req, res) => {
  try {
    const { comid } = req.params;
    const community = await Community.findById(comid).populate("posts");
    if (!community) {
      return res
        .status(400)
        .json({ success: false, message: "No Results Found" });
    }
    let postsArr = [];
    for (let i = 0; i < community.posts.length; i++) {
      const postId = community.posts[i];
      const post = await Post.findById(postId);
      console.log(post.title)
      if (post.kind !== "poll" || post.kind !== "product") {
        let final =
          post.views <= 0
            ? 0
            : (parseInt(post?.likes) / parseInt(post?.views)) * 100;

        let postdp;
        let video;
        let content;
        let thumbnail;
        if (post.post.length === 0) {
          postdp = null;
        } else {
          if (post.post[0].type.startsWith("video")) {
            if (!post.post[0].thumbnail) {
              postdp = POST_URL + post.post[0]?.content;
              thumbnail = POST_URL + post.post[0]?.thumbnail;
              video = true;
            } else {
              postdp = POST_URL + post.post[0]?.thumbnail;
              content = POST_URL + post.post[0]?.content;
              video = false;
            }
          } else {
            postdp = POST_URL + post.post[0]?.content;
            video = false;
          }
        }
        const postswithdp = {
          post,
          postdp,
          engrate: Math.round(final),
          video,
          content,
        };
        postsArr.push(postswithdp);
      } else {
        if (post.kind === "product") {
          let final =
            post.views <= 0
              ? 0
              : (parseInt(post?.likes) / parseInt(post?.views)) * 100;

          let postdp;
          let video;
          let content;
          let thumbnail;
          if (post.post.length === 0) {
            postdp = null;
          } else {
            if (post.post[0].type.startsWith("video")) {
              if (!post.post[0].thumbnail) {
                postdp = PRODUCT_URL + post.post[0]?.content;
                thumbnail = PRODUCT_URL + post.post[0]?.thumbnail;
                video = true;
              } else {
                postdp = PRODUCT_URL + post.post[0]?.thumbnail;
                content = PRODUCT_URL + post.post[0]?.content;
                video = false;
              }
            } else {
              postdp = PRODUCT_URL + post.post[0]?.content;
              video = false;
            }
          }
          const postswithdp = {
            post,
            postdp,
            engrate: Math.round(final),
            video,
            content,
          };
          postsArr.push(postswithdp);
        }
      }
    }

    const posts = postsArr.reverse();
    res.status(200).json({ success: true, posts });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.message, success: false });
  }
};

// old correct api
// exports.postanythings3workspace = async (req, res) => {
//   const { userId, comId } = req.params;
//   try {
//     if (req.fileValidationError) {
//       return res.status(400).json({
//         message: "File size limit exceeded",
//         success: false,
//       });
//     }

//     const { title, desc, tags, category, topicId, thumbnail } = req.body;
//     const tagArray = tags.split(",");

//     const user = await User.findById(userId);
//     const community = await Community.findById(comId);

//     let topic;
//     if (topicId && topicId !== "undefined") {
//       topic = await Topic.findById(topicId);
//     } else {
//       topic = await Topic.findById(community.topics[0].toString());
//     }

//     if (user && community && topic && req.files.length > 0) {
//       let pos = [];

//       if (thumbnail == "true") {
//         let thumbail = "";
//         let video = "";
//         for (const file of req.files) {
//           const uuidString = uuid();
//           const objectName = `${Date.now()}${uuidString}${file.originalname}`;

//           if (file.size <= 5 * 1024 * 1024) {
//             await s3.send(
//               new PutObjectCommand({
//                 Bucket: POST_BUCKET,
//                 Key: objectName,
//                 Body: file.buffer,
//                 ContentType: file.mimetype,
//               })
//             );

//             if (file.fieldname === "thumbnailImage") {
//               thumbail = objectName;
//             } else {
//               video = objectName;
//             }
//           } else {
//             // Multipart upload
//             const startParams = {
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               ContentType: file.mimetype,
//             };
//             const multipart = await s3.send(new CreateMultipartUploadCommand(startParams));
//             const uploadId = multipart.UploadId;
//             const partSize = 5 * 1024 * 1024; // 5MB
//             const partNumbers = Math.ceil(file.buffer.length / partSize);
//             let parts = [];

//             for (let partNumber = 1; partNumber <= partNumbers; partNumber++) {
//               const start = (partNumber - 1) * partSize;
//               const end = Math.min(start + partSize, file.buffer.length);
//               const partParams = {
//                 Bucket: POST_BUCKET,
//                 Key: objectName,
//                 PartNumber: partNumber,
//                 UploadId: uploadId,
//                 Body: file.buffer.slice(start, end),
//               };

//               const uploadPart = await s3.send(new UploadPartCommand(partParams));
//               parts.push({
//                 ETag: uploadPart.ETag,
//                 PartNumber: partNumber,
//               });
//             }

//             const completeParams = {
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               UploadId: uploadId,
//               MultipartUpload: { Parts: parts },
//             };
//             await s3.send(new CompleteMultipartUploadCommand(completeParams));

//             if (file.fieldname === "thumbnailImage") {
//               thumbail = objectName;
//             } else {
//               video = objectName;
//             }
//           }
//         }

//         pos.push({
//           content: video,
//           thumbnail: thumbail,
//           type: "video/mp4",
//         });

//       } else {
//         for (const file of req.files) {
//           const uuidString = uuid();
//           const objectName = `${Date.now()}${uuidString}${file.originalname}`;

//           if (file.size <= 5 * 1024 * 1024) {
//             await s3.send(
//               new PutObjectCommand({
//                 Bucket: POST_BUCKET,
//                 Key: objectName,
//                 Body: file.buffer,
//                 ContentType: file.mimetype,
//               })
//             );
//           } else {
//             const startParams = {
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               ContentType: file.mimetype,
//             };
//             const multipart = await s3.send(new CreateMultipartUploadCommand(startParams));
//             const uploadId = multipart.UploadId;
//             const partSize = 5 * 1024 * 1024; // 5MB
//             const partNumbers = Math.ceil(file.buffer.length / partSize);
//             let parts = [];

//             for (let partNumber = 1; partNumber <= partNumbers; partNumber++) {
//               const start = (partNumber - 1) * partSize;
//               const end = Math.min(start + partSize, file.buffer.length);
//               const partParams = {
//                 Bucket: POST_BUCKET,
//                 Key: objectName,
//                 PartNumber: partNumber,
//                 UploadId: uploadId,
//                 Body: file.buffer.slice(start, end),
//               };

//               const uploadPart = await s3.send(new UploadPartCommand(partParams));
//               parts.push({
//                 ETag: uploadPart.ETag,
//                 PartNumber: partNumber,
//               });
//             }

//             const completeParams = {
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               UploadId: uploadId,
//               MultipartUpload: { Parts: parts },
//             };
//             await s3.send(new CompleteMultipartUploadCommand(completeParams));
//           }
//           pos.push({ content: objectName, type: file.mimetype });
//         }
//       }

//       const post = new Post({
//         title,
//         desc,
//         community: comId,
//         sender: userId,
//         post: pos,
//         tags: tagArray,
//         topicId: topic._id,
//       });

//       const savedPost = await post.save();
//       const interest = await Interest.findOne({ title: category });

//       for (const tag of tagArray) {
//         const existingTag = await Tag.findOne({ title: tag.toLowerCase() });

//         if (existingTag) {
//           await Tag.updateOne(
//             { _id: existingTag._id },
//             { $inc: { count: 1 }, $addToSet: { post: post._id } }
//           );

//           if (interest) {
//             await Interest.updateOne(
//               { _id: interest._id },
//               {
//                 $inc: { count: 1 },
//                 $addToSet: { post: post._id, tags: existingTag._id },
//               }
//             );
//           }
//         } else {
//           const newTag = new Tag({
//             title: tag.toLowerCase(),
//             post: post._id,
//             count: 1,
//           });
//           await newTag.save();

//           if (interest) {
//             await Interest.updateOne(
//               { _id: interest._id },
//               {
//                 $inc: { count: 1 },
//                 $addToSet: { post: post._id, tags: newTag._id },
//               }
//             );
//           }
//         }
//       }

//       await Community.updateOne(
//         { _id: comId },
//         { $push: { posts: savedPost._id }, $inc: { totalposts: 1 } }
//       );

//       await Topic.updateOne(
//         { _id: topic._id },
//         { $push: { posts: savedPost._id }, $inc: { postcount: 1 } }
//       );

//       let tokens = [];

//       for (const memberId of community?.members) {
//         const member = await User.findById(memberId);

//         if (member?.notificationtoken && member?._id.toString() !== userId) {
//           tokens.push(member?.notificationtoken);
//         }
//       }

//       if (tokens?.length > 0) {
//         const msg = {
//           notification: {
//             title: `${community?.title} - Posted!`,
//             body: `${savedPost?.title}`,
//           },
//           data: {
//             screen: "CommunityChat",
//             sender_fullname: user?.fullname,
//             sender_id: user?._id.toString(),
//             text: savedPost?.title,
//             comId: community?._id.toString(),
//             createdAt: new Date().toISOString(),
//             type: "post",
//             link: `${POST_URL}${savedPost?.post[0]?.content}`,
//             comdp: `${URL}${community?.dp}`,
//           },
//           tokens: tokens,
//         };

//         // await admin?.messaging()?.sendMulticast(msg);
//       }

//       res.status(200).json({ savedPost, success: true });
//     } else {
//       res.status(404).json({
//         message: "User, Community, Topic not found, or no files were uploaded!",
//         success: false,
//       });
//     }
//   } catch (e) {
//     console.log(e);
//     res.status(500).json({ message: "Something went wrong", success: false });
//   }
// };

//start multipart
exports.startmultipart = async (req, res) => {
  // initialization
  let fileName = req.body.fileName;
  let contentType = req.body.contentType;

  const params = {
    Bucket: BUCKET_NAME,
    Key: fileName,
  };

  // add extra params if content type is video
  if (contentType == "VIDEO") {
    params.ContentDisposition = "inline";
    params.ContentType = "video/mp4";
  }

  try {
    const multipart = await s3multi.createMultipartUpload(params).promise();
    res.json({ uploadId: multipart.UploadId });
  } catch (error) {
    console.error("Error starting multipart upload:", error);
    return res.status(500).json({ error: "Error starting multipart upload" });
  }
};

//upload multipart
exports.uploadmulti = async (req, res) => {
  // get values from req body
  const { fileName, uploadId, partNumbers } = req.body;
  const totalParts = Array.from({ length: partNumbers }, (_, i) => i + 1);
  try {
    const presignedUrls = await Promise.all(
      totalParts.map(async (partNumber) => {
        const params = {
          Bucket: BUCKET_NAME,
          Key: fileName,
          PartNumber: partNumber,
          UploadId: uploadId,
          Expires: 3600 * 3,
        };

        return s3multi.getSignedUrl("uploadPart", {
          ...params,
        });
      })
    );
    res.json({ presignedUrls });
  } catch (error) {
    console.error("Error generating pre-signed URLs:", error);
    return res.status(500).json({ error: "Error generating pre-signed URLs" });
  }
};

exports.completemulti = async (req, res) => {
  // Req body
  let fileName = req.body.fileName;
  let uploadId = req.body.uploadId;
  let parts = req.body.parts;

  const params = {
    Bucket: BUCKET_NAME,
    Key: fileName,
    UploadId: uploadId,

    MultipartUpload: {
      Parts: parts.map((part, index) => ({
        ETag: part.etag,
        PartNumber: index + 1,
      })),
    },
  };
  try {
    const data = await s3multi.completeMultipartUpload(params).promise();
    res.status(200).json({ fileData: data });
  } catch (error) {
    console.error("Error completing multipart upload:", error);
    return res.status(500).json({ error: "Error completing multipart upload" });
  }
};

// const handleUpload = async () => {
//   if (!file) return;
//   try {
//     //  set isuploading true
//     setIsUploading(true);

//     // check file size if it is less than 10MB
//     if (file.size < 10000000) {
//       // Call your API to get the presigned URL
//       const response = await axios.post(
//         "http://localhost:8080/generate-single-presigned-url",
//         {
//           fileName: file.name,
//         }
//       );
//       const { url } = response.data;

//       // Use the presigned URL to upload the file
//       const uploadResponse = await axios.put(url, file, {
//         headers: {
//           "Content-Type": file.type,
//         },
//       });

//       console.log("Uplaodresponse- ", uploadResponse);

//       if (uploadResponse.status === 200) {
//         alert("File uploaded successfully.");
//       } else {
//         alert("Upload failed.");
//       }

//       // set isUpload false
//       setIsUploading(false);
//     } else {
//       // call multipart upload endpoint and get uploadId
//       const response = await axios.post(
//         "http://localhost:8080/start-multipart-upload",
//         {
//           fileName: file.name,
//           contentType: file.type,
//         }
//       );

//       // get uploadId
//       let { uploadId } = response.data;
//       console.log("UploadId- ", uploadId);

//       // get total size of the file
//       let totalSize = file.size;
//       // set chunk size to 10MB
//       let chunkSize = 10000000;
//       // calculate number of chunks
//       let numChunks = Math.ceil(totalSize / chunkSize);

//       // generate presigned urls
//       let presignedUrls_response = await axios.post(
//         "http://localhost:8080/generate-presigned-url",
//         {
//           fileName: file.name,
//           uploadId: uploadId,
//           partNumbers: numChunks,
//         }
//       );

//       let presigned_urls = presignedUrls_response?.data?.presignedUrls;

//       console.log("Presigned urls- ", presigned_urls);

//       // upload the file into chunks to different presigned url
//       let parts = [];
//       const uploadPromises = [];

//       for (let i = 0; i < numChunks; i++) {
//         let start = i * chunkSize;
//         let end = Math.min(start + chunkSize, totalSize);
//         console.log(file, start, end, "file");
//         let chunk = file.slice(start, end);
//         console.log("chunk", chunk);
//         let presignedUrl = presigned_urls[i];

//         uploadPromises.push(
//           axios.put(presignedUrl, chunk, {
//             headers: {
//               "Content-Type": file.type,
//             },
//           })
//         );
//       }

//       const uploadResponses = await Promise.all(uploadPromises);

//       uploadResponses.forEach((response, i) => {
//         // existing response handling

//         parts.push({
//           etag: response.headers.etag,
//           PartNumber: i + 1,
//         });
//       });

//       console.log("Parts- ", parts);

//       // make a call to multipart complete api
//       let complete_upload = await axios.post(
//         "http://localhost:8080/complete-multipart-upload",
//         {
//           fileName: file.name,
//           uploadId: uploadId,
//           parts: parts,
//         }
//       );

//       console.log("Complete upload- ", complete_upload.data);

//       // if upload is successful, alert user
//       if (complete_upload.status === 200) {
//         alert("File uploaded successfully.");
//       } else {
//         alert("Upload failed.");
//       }
//       // set isUpload false
//       setIsUploading(false);
//     }
//   } catch (error) {
//     alert("Upload failed.");
//   }
// };

exports.createcomment = async (req, res) => {
  const { userId, postId } = req.params;
  const { text } = req.body;
  const post = await Post.findById(postId);
  if (!post) {
    res.status(404).json({ message: "Post not found" });
  } else {
    try {
      const newComment = new Comment({
        senderId: userId,
        postId: postId,
        text: text,
      });
      await newComment.save();
      await Post.updateOne(
        { _id: postId },
        { $push: { comments: newComment._id }, $inc: { totalcomments: 1 } }
      );
      res.status(200).json({ success: true, newComment });
    } catch (e) {
      res.status(400).json(e.message);
    }
  }
};

exports.fetchallcomments = async (req, res) => {
  const { userId, postId } = req.params;
  try {
    const user = await User.findById(userId);
    const comment = await Comment.find({ postId: postId })
      .populate("senderId", "fullname profilepic username")
      .limit(50)
      .sort({ createdAt: -1 });

    if (!comment) {
      res.status(404).json({ success: false });
    } else {
      const liked = [];
      for (let i = 0; i < comment.length; i++) {
        if (comment[i].likedby.includes(user._id)) {
          liked.push("liked");
        } else {
          liked.push("not liked");
        }
      }
      const dps = [];
      for (let i = 0; i < comment.length; i++) {
        const a = URL + comment[i].senderId.profilepic;
        dps.push(a);
      }

      //merging all the data
      const merged = dps?.map((dp, i) => ({
        dp,
        comments: comment[i],
        likes: liked[i],
      }));
      res.status(200).json({ success: true, merged });
    }
  } catch (e) {
    res.status(400).json({ message: e.message, success: false });
  }
};

// exports.postanythings3workspace = async (req, res) => {
//   const { userId, comId } = req.params;
//   try {
//     if (req.fileValidationError) {
//       return res.status(400).json({
//         message: "File size limit exceeded",
//         success: false,
//       });
//     }

//     const { title, desc, tags, category, topicId, thumbnail } = req.body;
//     const tagArray = tags.split(",");

//     const user = await User.findById(userId);
//     const community = await Community.findById(comId);

//     let topic;
//     if (topicId && topicId !== "undefined") {
//       topic = await Topic.findById(topicId);
//     } else {
//       topic = await Topic.findById(community.topics[0].toString());
//     }

//     if (user && community && topic && req.files.length > 0) {
//       let pos = [];

//       if (thumbnail == "true") {
//         let thumbail = "";
//         let video = "";
//         for (const file of req.files) {
//           const uuidString = uuid();
//           const objectName = `${Date.now()}${uuidString}${file.originalname}`;

//           if (file.mimetype.startsWith('image/')) {
//             const compressedBuffer = await sharp(file.buffer)
//               .resize(800)
//               .toBuffer();

//             file.buffer = compressedBuffer;
//             file.size = compressedBuffer.length;
//           }

//           if (file.mimetype.startsWith('video/')) {
//             const temp = os.tmpdir()

//             // use this temp variable and join path 

//             const tempInputPath = path.join(temp, `${uuidString}_input.mp4`);
//             const tempOutputPath = path.join(temp, `${uuidString}_output.mp4`);
//             require('fs').writeFileSync(tempInputPath, file.buffer);

//             await new Promise((resolve, reject) => {
//               ffmpeg(tempInputPath)
//                 .videoCodec('libx264')
//                 .outputOptions('-crf', '28')
//                 .outputOptions('-b:v', '1M')
//                 .outputOptions('-maxrate', '1M')
//                 .outputOptions('-bufsize', '2M')
//                 .outputOptions('-b:a', '128k')
//                 .on('start', (commandLine) => {
//                   console.log('FFmpeg command:', commandLine);
//                 })
//                 .on('end', () => {
//                   console.log('FFmpeg processing finished.');
//                   resolve();
//                 })
//                 .on('error', (err) => {
//                   console.error('FFmpeg error:', err);
//                   reject(err);
//                 })
//                 .save(tempOutputPath);
//             });

//             file.buffer = require('fs').readFileSync(tempOutputPath);
//             file.size = file.buffer.length;

//             require('fs').unlinkSync(tempInputPath);
//             require('fs').unlinkSync(tempOutputPath);
//           }

//           if (file.size <= 5 * 1024 * 1024) {
//             await s3.send(
//               new PutObjectCommand({
//                 Bucket: POST_BUCKET,
//                 Key: objectName,
//                 Body: file.buffer,
//                 ContentType: file.mimetype,
//               })
//             );

//             if (file.fieldname === "thumbnailImage") {
//               thumbail = objectName;
//             } else {
//               video = objectName;
//             }
//           } else {
//             const startParams = {
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               ContentType: file.mimetype,
//             };
//             const multipart = await s3.send(new CreateMultipartUploadCommand(startParams));
//             const uploadId = multipart.UploadId;
//             const partSize = 5 * 1024 * 1024;
//             const partNumbers = Math.ceil(file.buffer.length / partSize);
//             let parts = [];

//             for (let partNumber = 1; partNumber <= partNumbers; partNumber++) {
//               const start = (partNumber - 1) * partSize;
//               const end = Math.min(start + partSize, file.buffer.length);
//               const partParams = {
//                 Bucket: POST_BUCKET,
//                 Key: objectName,
//                 PartNumber: partNumber,
//                 UploadId: uploadId,
//                 Body: file.buffer.slice(start, end),
//               };

//               const uploadPart = await s3.send(new UploadPartCommand(partParams));
//               parts.push({
//                 ETag: uploadPart.ETag,
//                 PartNumber: partNumber,
//               });
//             }

//             const completeParams = {
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               UploadId: uploadId,
//               MultipartUpload: { Parts: parts },
//             };
//             await s3.send(new CompleteMultipartUploadCommand(completeParams));

//             if (file.fieldname === "thumbnailImage") {
//               thumbail = objectName;
//             } else {
//               video = objectName;
//             }
//           }
//         }

//         pos.push({
//           content: video,
//           thumbnail: thumbail,
//           type: "video/mp4",
//         });

//       } else {
//         for (const file of req.files) {
//           const uuidString = uuid();
//           const objectName = `${Date.now()}${uuidString}${file.originalname}`;

//           if (file.mimetype.startsWith('image/')) {
//             const compressedBuffer = await sharp(file.buffer)
//               .resize(800)
//               .toBuffer();

//             file.buffer = compressedBuffer;
//             file.size = compressedBuffer.length;
//           }

//           if (file.mimetype.startsWith('video/')) {

//             const temp = os.tmpdir()

//             // use this temp variable and join path 

//             const tempInputPath = path.join(temp, `${uuidString}_input.mp4`);
//             const tempOutputPath = path.join(temp, `${uuidString}_output.mp4`);

//             require('fs').writeFileSync(tempInputPath, file.buffer);

//             await new Promise((resolve, reject) => {
//               ffmpeg(tempInputPath)
//                 .videoCodec('libx264')
//                 .outputOptions('-crf', '28')
//                 .outputOptions('-b:v', '1M')
//                 .outputOptions('-maxrate', '1M')
//                 .outputOptions('-bufsize', '2M')
//                 .outputOptions('-b:a', '128k')
//                 .on('start', (commandLine) => {
//                   console.log('FFmpeg command:', commandLine);
//                 })
//                 .on('end', () => {
//                   console.log('FFmpeg processing finished.');
//                   resolve();
//                 })
//                 .on('error', (err) => {
//                   console.error('FFmpeg error:', err);
//                   reject(err);
//                 })
//                 .save(tempOutputPath);
//             });

//             file.buffer = require('fs').readFileSync(tempOutputPath);
//             file.size = file.buffer.length;

//             require('fs').unlinkSync(tempInputPath);
//             require('fs').unlinkSync(tempOutputPath);
//           }

//           if (file.size <= 5 * 1024 * 1024) {
//             await s3.send(
//               new PutObjectCommand({
//                 Bucket: POST_BUCKET,
//                 Key: objectName,
//                 Body: file.buffer,
//                 ContentType: file.mimetype,
//               })
//             );
//           } else {
//             const startParams = {
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               ContentType: file.mimetype,
//             };
//             const multipart = await s3.send(new CreateMultipartUploadCommand(startParams));
//             const uploadId = multipart.UploadId;
//             const partSize = 5 * 1024 * 1024;
//             const partNumbers = Math.ceil(file.buffer.length / partSize);
//             let parts = [];

//             for (let partNumber = 1; partNumber <= partNumbers; partNumber++) {
//               const start = (partNumber - 1) * partSize;
//               const end = Math.min(start + partSize, file.buffer.length);
//               const partParams = {
//                 Bucket: POST_BUCKET,
//                 Key: objectName,
//                 PartNumber: partNumber,
//                 UploadId: uploadId,
//                 Body: file.buffer.slice(start, end),
//               };

//               const uploadPart = await s3.send(new UploadPartCommand(partParams));
//               parts.push({
//                 ETag: uploadPart.ETag,
//                 PartNumber: partNumber,
//               });
//             }

//             const completeParams = {
//               Bucket: POST_BUCKET,
//               Key: objectName,
//               UploadId: uploadId,
//               MultipartUpload: { Parts: parts },
//             };
//             await s3.send(new CompleteMultipartUploadCommand(completeParams));
//           }
//           pos.push({ content: objectName, type: file.mimetype });
//         }
//       }

//       const post = new Post({
//         title,
//         desc,
//         community: comId,
//         sender: userId,
//         post: pos,
//         tags: tagArray,
//         topicId: topic._id,
//       });

//       const savedPost = await post.save();
//       const interest = await Interest.findOne({ title: category });

//       for (const tag of tagArray) {
//         const existingTag = await Tag.findOne({ title: tag.toLowerCase() });

//         if (existingTag) {
//           await Tag.updateOne(
//             { _id: existingTag._id },
//             { $inc: { count: 1 }, $addToSet: { post: post._id } }
//           );

//           if (interest) {
//             await Interest.updateOne(
//               { _id: interest._id },
//               {
//                 $inc: { count: 1 },
//                 $addToSet: { post: post._id, tags: existingTag._id },
//               }
//             );
//           }
//         } else {
//           const newTag = new Tag({
//             title: tag.toLowerCase(),
//             post: post._id,
//             count: 1,
//           });
//           await newTag.save();

//           if (interest) {
//             await Interest.updateOne(
//               { _id: interest._id },
//               {
//                 $inc: { count: 1 },
//                 $addToSet: { post: post._id, tags: newTag._id },
//               }
//             );
//           }
//         }
//       }

//       await Community.updateOne(
//         { _id: comId },
//         { $push: { posts: savedPost._id }, $inc: { totalposts: 1 } }
//       );

//       await Topic.updateOne(
//         { _id: topic._id },
//         { $push: { posts: savedPost._id }, $inc: { postcount: 1 } }
//       );

//       let tokens = [];

//       for (const memberId of community?.members) {
//         const member = await User.findById(memberId);

//         if (member?.notificationtoken && member?._id.toString() !== userId) {
//           tokens.push(member?.notificationtoken);
//         }
//       }

//       const message = {
//         notification: {
//           title: user.name,
//           body: `Added a post to ${community?.name}`,
//         },
//         tokens,
//       };

//       // admin.messaging().sendMulticast(message);

//       res.status(200).json({
//         success: true,
//         message: "Posted successfully",
//         data: savedPost,
//       });
//     } else {
//       res.status(400).json({
//         success: false,
//         message: "Invalid input",
//       });
//     }
//   } catch (err) {
//     console.log(err)
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

exports.postanythings3workspace = async (req, res) => {
  const { userId, comId } = req.params;
  try {
    if (req.fileValidationError) {
      return res.status(400).json({
        message: "File size limit exceeded",
        success: false,
      });
    }

    const { title, desc, tags, category, topicId, thumbnail } = req.body;
    const tagArray = tags.split(",");

    const user = await User.findById(userId);
    const community = await Community.findById(comId);

    let topic;
    if (topicId && topicId !== "undefined") {
      topic = await Topic.findById(topicId);
    } else {
      topic = await Topic.findById(community.topics[0].toString());
    }

    if (user && community && topic && req.files.length > 0) {
      let pos = [];

      if (thumbnail == "true") {
        let thumbail = "";
        let video = "";
        for (const file of req.files) {
          const uuidString = uuid();
          const objectName = `${Date.now()}${uuidString}${file.originalname}`;

          if (file.mimetype.startsWith('image/')) {
            const compressedBuffer = await sharp(file.buffer)
              .resize(800)
              .toBuffer();

            file.buffer = compressedBuffer;
            file.size = compressedBuffer.length;
          }

          if (file.size <= 5 * 1024 * 1024) {
            await s3.send(
              new PutObjectCommand({
                Bucket: POST_BUCKET,
                Key: objectName,
                Body: file.buffer,
                ContentType: file.mimetype,
              })
            );

            if (file.fieldname === "thumbnailImage") {
              thumbail = objectName;
            } else {
              video = objectName;
            }
          } else {
            const startParams = {
              Bucket: POST_BUCKET,
              Key: objectName,
              ContentType: file.mimetype,
            };
            const multipart = await s3.send(new CreateMultipartUploadCommand(startParams));
            const uploadId = multipart.UploadId;
            const partSize = 5 * 1024 * 1024;
            const partNumbers = Math.ceil(file.buffer.length / partSize);
            let parts = [];

            for (let partNumber = 1; partNumber <= partNumbers; partNumber++) {
              const start = (partNumber - 1) * partSize;
              const end = Math.min(start + partSize, file.buffer.length);
              const partParams = {
                Bucket: POST_BUCKET,
                Key: objectName,
                PartNumber: partNumber,
                UploadId: uploadId,
                Body: file.buffer.slice(start, end),
              };

              const uploadPart = await s3.send(new UploadPartCommand(partParams));
              parts.push({
                ETag: uploadPart.ETag,
                PartNumber: partNumber,
              });
            }

            const completeParams = {
              Bucket: POST_BUCKET,
              Key: objectName,
              UploadId: uploadId,
              MultipartUpload: { Parts: parts },
            };
            await s3.send(new CompleteMultipartUploadCommand(completeParams));

            if (file.fieldname === "thumbnailImage") {
              thumbail = objectName;
            } else {
              video = objectName;
            }
            if (file.mimetype.startsWith('video/')) {
              if (file.mimetype.startsWith('video/')) {
                await videoCompressionQueue.add('compressVideo', {
                  bucket: POST_BUCKET,
                  key: objectName,
                });
              }

            }
          }
        }

        pos.push({
          content: video,
          thumbnail: thumbail,
          type: "video/mp4",
        });

      } else {
        for (const file of req.files) {
          const uuidString = uuid();
          const objectName = `${Date.now()}${uuidString}${file.originalname}`;

          if (file.mimetype.startsWith('image/')) {
            const compressedBuffer = await sharp(file.buffer)
              .resize(800)
              .toBuffer();

            file.buffer = compressedBuffer;
            file.size = compressedBuffer.length;
          }


          if (file.size <= 5 * 1024 * 1024) {
            await s3.send(
              new PutObjectCommand({
                Bucket: POST_BUCKET,
                Key: objectName,
                Body: file.buffer,
                ContentType: file.mimetype,
              })
            );
          } else {
            const startParams = {
              Bucket: POST_BUCKET,
              Key: objectName,
              ContentType: file.mimetype,
            };
            const multipart = await s3.send(new CreateMultipartUploadCommand(startParams));
            const uploadId = multipart.UploadId;
            const partSize = 5 * 1024 * 1024;
            const partNumbers = Math.ceil(file.buffer.length / partSize);
            let parts = [];

            for (let partNumber = 1; partNumber <= partNumbers; partNumber++) {
              const start = (partNumber - 1) * partSize;
              const end = Math.min(start + partSize, file.buffer.length);
              const partParams = {
                Bucket: POST_BUCKET,
                Key: objectName,
                PartNumber: partNumber,
                UploadId: uploadId,
                Body: file.buffer.slice(start, end),
              };

              const uploadPart = await s3.send(new UploadPartCommand(partParams));
              parts.push({
                ETag: uploadPart.ETag,
                PartNumber: partNumber,
              });
            }

            const completeParams = {
              Bucket: POST_BUCKET,
              Key: objectName,
              UploadId: uploadId,
              MultipartUpload: { Parts: parts },
            };
            await s3.send(new CompleteMultipartUploadCommand(completeParams));

            if (file.mimetype.startsWith('video/')) {
              if (file.mimetype.startsWith('video/')) {
                await videoCompressionQueue.add('compressVideo', {
                  bucket: POST_BUCKET,
                  key: objectName,
                });
              }

            }
          }
          pos.push({ content: objectName, type: file.mimetype });
        }
      }

      const post = new Post({
        title,
        desc,
        community: comId,
        sender: userId,
        post: pos,
        tags: tagArray,
        topicId: topic._id,
      });

      const savedPost = await post.save();
      const interest = await Interest.findOne({ title: category });

      for (const tag of tagArray) {
        const existingTag = await Tag.findOne({ title: tag.toLowerCase() });

        if (existingTag) {
          await Tag.updateOne(
            { _id: existingTag._id },
            { $inc: { count: 1 }, $addToSet: { post: post._id } }
          );

          if (interest) {
            await Interest.updateOne(
              { _id: interest._id },
              {
                $inc: { count: 1 },
                $addToSet: { post: post._id, tags: existingTag._id },
              }
            );
          }
        } else {
          const newTag = new Tag({
            title: tag.toLowerCase(),
            post: post._id,
            count: 1,
          });
          await newTag.save();

          if (interest) {
            await Interest.updateOne(
              { _id: interest._id },
              {
                $inc: { count: 1 },
                $addToSet: { post: post._id, tags: newTag._id },
              }
            );
          }
        }
      }

      await Community.updateOne(
        { _id: comId },
        { $push: { posts: savedPost._id }, $inc: { totalposts: 1 } }
      );

      await Topic.updateOne(
        { _id: topic._id },
        { $push: { posts: savedPost._id }, $inc: { postcount: 1 } }
      );

      let tokens = [];

      for (const memberId of community?.members) {
        const member = await User.findById(memberId);

        if (member?.notificationtoken && member?._id.toString() !== userId) {
          tokens.push(member?.notificationtoken);
        }
      }

      const message = {
        notification: {
          title: user.name,
          body: `Added a post to ${community?.name}`,
        },
        tokens,
      };

      // admin.messaging().sendMulticast(message);

      res.status(200).json({
        success: true,
        message: "Posted successfully",
        data: savedPost,
      });
    } else {
      res.status(400).json({
        success: false,
        message: "Invalid input",
      });
    }
  } catch (err) {
    console.log(err)
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// async function checkQueue() {
//   const waitingJobs = await videoCompressionQueue.getWaiting(); // Jobs waiting to be processed
//   const activeJobs = await videoCompressionQueue.getActive();   // Jobs currently being processed
//   const completedJobs = await videoCompressionQueue.getCompleted(); // Completed jobs
//   const failedJobs = await videoCompressionQueue.getFailed();   // Failed jobs

//   console.log('Waiting Jobs:', waitingJobs);
//   console.log('Active Jobs:', activeJobs);
//   console.log('Completed Jobs:', completedJobs);
//   console.log('Failed Jobs:', failedJobs);
// }

// checkQueue();


// async function retryFailedJobs() {
//   try {
//     // Get the list of failed jobs
//     const failedJobs = await videoCompressionQueue.getFailed();

//     // Loop through the failed jobs and retry them
//     for (const job of failedJobs) {
//       console.log(`Retrying job ${job.id}`);
//       await job.retry();  // This will reprocess the job
//     }
//   } catch (error) {
//     console.error('Error retrying failed jobs:', error);
//   }
// }

// retryFailedJobs();

const cleanArray = (arr) => {
  return arr.filter(item =>
    item !== null &&
    item !== undefined &&
    item !== "" &&
    item.trim() !== ""
  );
};

exports.newfetchfeed = async (req, res) => {

  try {
    const { id } = req.params;

    // Step 1: Check cache
    let user = myCache.get(`user:${id}`);

    if (!user) {
      console.log("Fetching from database...");
      user = await User.findById(id).select("activeinterest interest fullname username profilepic isverified").lean();
      myCache.set(`user:${id}`, user, 3600);
    }

    const interestsWithTags = await Interest.find({
      title: { $in: user.interest } // Find interests that match user.interest
    })
      .select("tags")
      .populate("tags", "title")
      .lean().limit(3);


    const limitedInterests = interestsWithTags.map(interest => ({
      ...interest,
      tags: interest.tags.slice(0, 3) // Limit tags to the first 3
    }));

    // Extract and log tag titles from the limited tags
    const tags = limitedInterests.flatMap(interest =>
      interest.tags.map(tag => tag.title) // Extract only the title
    );

    const cleanedTags = cleanArray(tags);

    // Step 3: Fetch banner ad
    const banner = await Ads.findOne({
      status: "active",
      $or: [{ type: "banner" }],
    })
      .sort({ cpa: -1 })
      .populate({
        path: "postid",
        select: "desc post title kind likes likedby comments members community cta ctalink sender totalcomments adtype date createdAt",
        populate: [
          {
            path: "community",
            select: "dp title isverified memberscount members",
            populate: { path: "members", select: "profilepic" },
          },
          { path: "sender", select: "profilepic fullname" },
        ],
      })
      .limit(1);

    // Step 4: Aggregate posts with necessary lookups
    const posts = await Post.aggregate([
      {
        $lookup: {
          from: "communities",
          localField: "community",
          foreignField: "_id",
          as: "communityInfo",
        },
      },
      {
        $match: {
          $or: [
            { "communityInfo.category": { $in: user.interest } }, // Match community categories
            {
              $or: [{ tags: { $in: cleanedTags } }, { tags: { $exists: false } }],
            },
          ],
        },
      },
      { $sample: { size: 15 } },
      {
        $lookup: {
          from: "users",
          localField: "sender",
          foreignField: "_id",
          as: "sender",
        },
      },
      {
        $lookup: {
          from: "communities",
          localField: "community",
          foreignField: "_id",
          as: "community",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "community.members",
          foreignField: "_id",
          as: "members",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "community.type",
          foreignField: "_id",
          as: "type",
        },
      },
      {
        $addFields: {
          sender: { $arrayElemAt: ["$sender", 0] },
          community: { $arrayElemAt: ["$community", 0] },
        },
      },
      {
        $addFields: {
          "community.members": {
            $map: {
              input: { $slice: ["$members", 0, 4] },
              as: "member",
              in: {
                _id: "$$member._id",
                fullname: "$$member.fullname",
                profilepic: "$$member.profilepic",
              },
            },
          },
        },
      },
      {
        $match: {
          "community.type": { $eq: "public" }, // Excluding posts with community type other than "public"
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          createdAt: 1,
          status: 1,
          likedby: 1,
          likes: 1,
          dislike: 1,
          comments: 1,
          totalcomments: 1,
          tags: 1,
          view: 1,
          desc: 1,
          isverified: 1,
          post: 1,
          contenttype: 1,
          date: 1,
          sharescount: 1,
          sender: {
            _id: 1,
            fullname: 1,
            profilepic: 1,
          },
          community: {
            _id: 1,
            title: 1,
            dp: 1,
            members: 1,
            memberscount: 1,
            isverified: 1,
            type: 1,
          },
          topicId: 1,
        },
      },
    ]);

    if (!posts) {
      res.status(201).json({ message: "No post found", success: false });
      return;
    }

    // Process posts
    const mergedData = posts.map(post => {
      const liked = post.likedby?.some(id => id.toString() === user._id.toString());
      const subscribed = post.community.members.includes(user._id) ? "subscribed" : "unsubscribed";

      const dps = process.env.URL + post.community.dp;

      const urls = post.post.map(p => ({
        content: p.link ? process.env.POST_URL + p.content + "640.mp4" : process.env.POST_URL + p.content,
        thumbnail: p.thumbnail ? process.env.POST_URL + p.thumbnail : undefined,
        type: p.type
      }));

      const memdps = post.community.members.slice(0, 4).map(member =>
        process.env.URL + member.profilepic
      );

      return {
        dps,
        memdps,
        urls,
        liked,
        subs: subscribed,
        posts: post
      };
    });

    if (banner) {
      mergedData.unshift({
        dps: process.env.URL + banner.postid.community.dp,
        memdps: banner.postid.community.members.slice(0, 4).map(member =>
          process.env.URL + member.profilepic
        ),
        urls: banner.postid.post.map(p => ({
          content: p.link ? process.env.POST_URL + p.content + "640.mp4" : process.env.POST_URL + p.content,
          thumbnail: p.thumbnail ? process.env.POST_URL + p.thumbnail : undefined,
          type: p.type
        })),
        liked: banner.postid.likedby?.some(id => id.toString() === user._id.toString()),
        subs: banner.postid.community.members.includes(user._id) ? "subscribed" : "unsubscribed",
        posts: banner.postid
      });
    }

    res.status(200).json({
      mergedData,
      success: true,
    });

  } catch (err) {
    console.log("Error:", err);
    res.status(500).json({ message: "Failed to fetch user data", success: false });
  }
};

exports.newforyoufetchMore = async (req, res) => {
  try {

    const { fetchAds } = req.body
    const adIds = JSON.parse(fetchAds) || []
    const { id } = req.params
    let user = myCache.get(`user:${id}`);

    if (!user) {
      console.log("Fetching from database...");
      user = await User.findById(id).select("activeinterest interest fullname username profilepic isverified").lean();
      myCache.set(`user:${id}`, user, 3600);
    } else {
      console.log("cached");
    }

    if (user?.activeinterest?.length > 0) {

      const interestsWithTags = await Interest.find({
        title: { $in: user?.activeinterest } // Find interests that match user.interest
      })
        .select("tags")
        .populate("tags", "title")
        .lean().limit(3);


      const limitedInterests = interestsWithTags.map(interest => ({
        ...interest,
        tags: interest.tags.slice(0, 3) // Limit tags to the first 3
      }));

      // Extract and log tag titles from the limited tags
      const tags = limitedInterests.flatMap(interest =>
        interest.tags.map(tag => tag.title) // Extract only the title
      );

      const cleanedTags = cleanArray(tags);

      let query = {
        status: "active",
        $or: [{ type: "infeed" }]
      };

      // Conditionally add _id filter only if adIds is provided and not empty
      if (adIds && adIds.length > 0) {
        query._id = { $nin: adIds };
      }

      const infeedad = await Ads.findOne(query).populate({
        path: "postid",
        select:
          "desc post title kind likes comments community cta ctalink likedby sender totalcomments adtype date createdAt",
        populate: [
          {
            path: "community",
            select: "dp title isverified memberscount members",
            populate: { path: "members", select: "profilepic" },
          },
          { path: "sender", select: "profilepic fullname" },
        ],
      });

      const posts = await Post.aggregate([
        {
          $lookup: {
            from: "communities",
            localField: "community",
            foreignField: "_id",
            as: "communityInfo",
          },
        },
        {
          $match: {
            $or: [
              { "communityInfo.category": { $in: user.interest } }, // Match community categories
              {
                $or: [{ tags: { $in: cleanedTags } }, { tags: { $exists: false } }],
              },
            ],
          },
        },
        { $sample: { size: 7 } },
        {
          $lookup: {
            from: "users",
            localField: "sender",
            foreignField: "_id",
            as: "sender",
          },
        },
        {
          $lookup: {
            from: "communities",
            localField: "community",
            foreignField: "_id",
            as: "community",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "community.members",
            foreignField: "_id",
            as: "members",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "community.type",
            foreignField: "_id",
            as: "type",
          },
        },
        {
          $addFields: {
            sender: { $arrayElemAt: ["$sender", 0] },
            community: { $arrayElemAt: ["$community", 0] },
          },
        },
        {
          $addFields: {
            "community.members": {
              $map: {
                input: { $slice: ["$members", 0, 4] },
                as: "member",
                in: {
                  _id: "$$member._id",
                  fullname: "$$member.fullname",
                  profilepic: "$$member.profilepic",
                },
              },
            },
          },
        },
        {
          $match: {
            "community.type": { $eq: "public" }, // Excluding posts with community type other than "public"
          },
        },
        {
          $project: {
            _id: 1,
            title: 1,
            createdAt: 1,
            status: 1,
            likedby: 1,
            likes: 1,
            dislike: 1,
            comments: 1,
            totalcomments: 1,
            tags: 1,
            view: 1,
            desc: 1,
            isverified: 1,
            post: 1,
            contenttype: 1,
            date: 1,
            sharescount: 1,
            sender: {
              _id: 1,
              fullname: 1,
              profilepic: 1,
            },
            community: {
              _id: 1,
              title: 1,
              dp: 1,
              members: 1,
              memberscount: 1,
              isverified: 1,
              type: 1,
            },
            topicId: 1,
          },
        },
      ]);

      if (!posts) {
        res.status(201).json({ message: "No post found", success: false });
        return;
      }

      // Process posts
      const mergedData = posts.map(post => {
        const liked = post.likedby?.some(id => id.toString() === user._id.toString());
        const subscribed = post.community?.members?.includes(user._id) ? "subscribed" : "unsubscribed";

        const dps = process.env.URL + post?.community?.dp;

        const urls = post.post?.map(p => ({
          content: p.link ? process.env.POST_URL + p?.content + "640.mp4" : process.env.POST_URL + p?.content,
          thumbnail: p?.thumbnail ? process.env.POST_URL + p?.thumbnail : undefined,
          type: p.type
        }));

        const memdps = post?.community?.members.slice(0, 4).map(member =>
          process.env.URL + member?.profilepic
        );

        return {
          dps,
          memdps,
          urls,
          liked,
          subs: subscribed,
          posts: post
        };
      });

      if (infeedad) {
        mergedData.push({
          dps: process.env.URL + infeedad?.postid?.community.dp,
          memdps: infeedad.postid?.community?.members?.slice(0, 4).map(member =>
            process.env.URL + member.profilepic
          ),
          urls: infeedad.postid.post.map(p => ({
            content: p?.link ? process.env.POST_URL + p?.content + "640.mp4" : process.env.POST_URL + p?.content,
            thumbnail: p?.thumbnail ? process.env.POST_URL + p?.thumbnail : undefined,
            type: p.type
          })),
          liked: infeedad?.postid?.likedby?.some(id => id.toString() === user._id.toString()),
          subs: infeedad?.postid?.community?.members?.includes(user._id) ? "subscribed" : "unsubscribed",
          posts: infeedad.postid
        });

      }

      res.status(200).json({
        mergedData,
        adid: infeedad ? infeedad._id : null,
        success: true,
      });

    } else {
      const interestsWithTags = await Interest.find({
        title: { $in: user?.interest } // Find interests that match user.interest
      })
        .select("tags")
        .populate("tags", "title")
        .lean().limit(3);


      const limitedInterests = interestsWithTags.map(interest => ({
        ...interest,
        tags: interest.tags.slice(0, 3) // Limit tags to the first 3
      }));

      // Extract and log tag titles from the limited tags
      const tags = limitedInterests.flatMap(interest =>
        interest.tags.map(tag => tag.title) // Extract only the title
      );

      const cleanedTags = cleanArray(tags);

      let query = {
        status: "active",
        $or: [{ type: "infeed" }]
      };

      // Conditionally add _id filter only if adIds is provided and not empty
      if (adIds && adIds.length > 0) {
        query._id = { $nin: adIds };
      }


      const infeedad = await Ads.findOne(query).populate({
        path: "postid",
        select:
          "desc post title kind likes comments community cta ctalink likedby sender totalcomments adtype date createdAt",
        populate: [
          {
            path: "community",
            select: "dp title isverified memberscount members",
            populate: { path: "members", select: "profilepic" },
          },
          { path: "sender", select: "profilepic fullname" },
        ],
      });

      const posts = await Post.aggregate([
        {
          $lookup: {
            from: "communities",
            localField: "community",
            foreignField: "_id",
            as: "communityInfo",
          },
        },
        {
          $match: {
            $or: [
              { "communityInfo.category": { $in: user.interest } }, // Match community categories
              {
                $or: [{ tags: { $in: cleanedTags } }, { tags: { $exists: false } }],
              },
            ],
          },
        },
        { $sample: { size: 7 } },
        {
          $lookup: {
            from: "users",
            localField: "sender",
            foreignField: "_id",
            as: "sender",
          },
        },
        {
          $lookup: {
            from: "communities",
            localField: "community",
            foreignField: "_id",
            as: "community",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "community.members",
            foreignField: "_id",
            as: "members",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "community.type",
            foreignField: "_id",
            as: "type",
          },
        },
        {
          $addFields: {
            sender: { $arrayElemAt: ["$sender", 0] },
            community: { $arrayElemAt: ["$community", 0] },
          },
        },
        {
          $addFields: {
            "community.members": {
              $map: {
                input: { $slice: ["$members", 0, 4] },
                as: "member",
                in: {
                  _id: "$$member._id",
                  fullname: "$$member.fullname",
                  profilepic: "$$member.profilepic",
                },
              },
            },
          },
        },
        {
          $match: {
            "community.type": { $eq: "public" }, // Excluding posts with community type other than "public"
          },
        },
        {
          $project: {
            _id: 1,
            title: 1,
            createdAt: 1,
            status: 1,
            likedby: 1,
            likes: 1,
            dislike: 1,
            comments: 1,
            totalcomments: 1,
            tags: 1,
            view: 1,
            desc: 1,
            isverified: 1,
            post: 1,
            contenttype: 1,
            date: 1,
            sharescount: 1,
            sender: {
              _id: 1,
              fullname: 1,
              profilepic: 1,
            },
            community: {
              _id: 1,
              title: 1,
              dp: 1,
              members: 1,
              memberscount: 1,
              isverified: 1,
              type: 1,
            },
            topicId: 1,
          },
        },
      ])

      if (!posts) {
        res.status(201).json({ message: "No post found", success: false });
        return;
      }
      // Process posts
      const mergedData = posts.map(post => {
        const liked = post.likedby?.some(id => id.toString() === user._id.toString());
        const subscribed = post?.community?.members?.includes(user._id) ? "subscribed" : "unsubscribed";

        const dps = process.env.URL + post.community?.dp;

        const urls = post?.post?.map(p => ({
          content: p.link ? process.env.POST_URL + p?.content + "640.mp4" : process.env.POST_URL + p?.content,
          thumbnail: p?.thumbnail ? process.env.POST_URL + p?.thumbnail : undefined,
          type: p?.type
        }));

        const memdps = post?.community?.members?.slice(0, 4).map(member =>
          process.env.URL + member?.profilepic
        );

        return {
          dps,
          memdps,
          urls,
          liked,
          subs: subscribed,
          posts: post
        }

      });

      if (infeedad) {
        mergedData.push({
          dps: process.env.URL + infeedad.postid.community.dp,
          memdps: infeedad.postid.community.members.slice(0, 4).map(member =>
            process.env.URL + member.profilepic
          ),
          urls: infeedad.postid.post.map(p => ({
            content: p.link ? process.env.POST_URL + p.content + "640.mp4" : process.env.POST_URL + p.content,
            thumbnail: p.thumbnail ? process.env.POST_URL + p.thumbnail : undefined,
            type: p.type
          })),
          liked: infeedad.postid.likedby?.some(id => id.toString() === user._id.toString()),
          subs: infeedad.postid.community.members.includes(user._id) ? "subscribed" : "unsubscribed",
          posts: infeedad.postid
        });
      }

      res.status(200).json({
        mergedData,
        success: true,
      });
    }
  } catch (error) {
    console.log(error)
  }
}

const activeSubscription = async (id) => {
  try {
    const user = await User.findById(id)

    const inter = ["Movies & Entertainment", "Science & Learning", "Gaming"]

    // user.activeinterest = []
    user.activeinterest = inter

    await user.save()
    console.log("first")
  } catch (error) {
    console.log(error)
  }
}
// activeSubscription("65b68725750001cd4dc81483")



// Replace with actual media names
// processMedia(mediaNames);
