const mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema;

const PostSchema = new mongoose.Schema(
  {
    likedby: [{ type: ObjectId, ref: "User", required: true }],
    likes: { type: Number, default: 0 },
    dislike: { type: Number, default: 0 },
    dislikedby: [{ type: ObjectId, ref: "User", required: true }],
    comments: { type: [String], default: [] },
    totalcomments: { type: Number, default: 0 },
    tags: { type: [String] },
    views: { type: Number, default: 0 },
    title: { type: String },
    desc: { type: String },
    community: { type: ObjectId, ref: "Community" },
    sender: { type: ObjectId, ref: "User" },
    isverified: { type: Boolean, default: false },
    commpic: { type: ObjectId, ref: "Community" },
    isPromoted: { type: Boolean, default: false },
    promoid: { type: ObjectId, ref: "Post" },
    topicId: { type: ObjectId, ref: "Topic" },
    post: [
      {
        content: { type: String },
        type: { type: String },
        size: { type: String },
        thumbnail: { type: String },
        resolution: { type: String, default: "original" },
      },
    ],
    kind: { type: String, default: "post" },
    contenttype: { type: [String] },
    user: { type: String },
    date: { type: Date, default: Date.now() },
    status: {
      type: String,
      default: "Unblock",
      enum: ["Unblock", "Block"],
    },
    sharescount: { type: Number, default: 0 },
    adtype: { type: String },
    cta: { type: String },
    ctalink: { type: String },
    type: { type: String, default: "Post" },
  },
  { timestamps: true, strict: false }
);

PostSchema.index({ title: "text" });

module.exports = mongoose.model("Post", PostSchema);
