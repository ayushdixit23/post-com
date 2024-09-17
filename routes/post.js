const express = require("express");
const router = express.Router();
const multer = require("multer");
const {
  likepost,
  dislikepost,
  deletepost,
  newfetchfeeds3,
  joinedcomnews3,
  postanythings3,
  fetchmoredata,
  startmultipart,
  uploadmulti,
  completemulti,
  removecomwithposts,
  postanythings3workspace,
  getallposts,
  editPosts,
  fetchallcomments,
  createcomment,
  newfetchfeed,
  newforyoufetchMore,
} = require("../controllers/post");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 100000000000 } });

//Mobile App

//post anything
router.post("/v1/postanything", upload.any(), postanythings3);

//feed - new for you
router.get("/v1/getfeed/:id", newfetchfeed);

//load more - new for you
router.get("/v1/fetchmore/:userId", fetchmoredata);

//feed - community
router.get("/v1/getfollowingfeed/:userId", joinedcomnews3);

//like a post
router.post("/likepost/:userId/:postId", likepost);

//dislike a post
router.post("/dislikepost/:userId/:postId", dislikepost);

//delete a post
router.delete("/deletepost/:userId/:postId", deletepost);

//start multipart upload
router.post("/start-multipart-upload", startmultipart);

//uploading multipart
router.post("/generate-presigned-url", uploadmulti);

//complete multipart upload
router.post("/complete-multipart-upload", completemulti);

//Workspace

//post edit
router.post("/editpost/:userId/:postId", upload.any(), editPosts);

//remove community along posts
router.post("/removecomwithposts/:id/:comId", removecomwithposts);

//post anything to workspace
router.post(
  "/postanythingworkspace/:userId/:comId",
  upload.any(),
  postanythings3workspace
);

//get all posts

router.get("/fetchallcomments/:userId/:postId", fetchallcomments);

router.post("/createcomment/:userId/:postId", createcomment);
router.post("/fetchmore/:id", newforyoufetchMore);

router.get("/getallposts/:comid", getallposts);

module.exports = router;

// front =>  size of combine => 100 mb
// multipart

