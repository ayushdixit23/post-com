const mongoose = require("mongoose");
const crypto = require("crypto");
const { ObjectId } = mongoose.Schema;

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      trim: true,
      maxLength: 50,
    },
    hashed_password: {
      type: String,
    },
    gender: {
      type: String,
    },
    passw: { type: String },
    otp: { type: String },
    salt: String,
    governmentid: { type: String },
    role: {
      type: String,
      default: "User",
    },
    resetPasswordLink: {
      data: String,
    },
    profilepic: { type: String },
    fullname: {
      type: String,
      maxLength: 30,
    },
    token: { type: String },
    phone: { type: String, trim: true, unique: true },
    DOB: { type: String },
    guide: { type: Boolean, default: false },
    username: {
      type: String,
      maxLength: 30,
      trim: true,
      unique: true,
    },

    deliveryforcity: { type: Number },
    deliveryforcountry: { type: Number },
    prositeweb_template: {
      type: String,
    },
    prositemob_template: {
      type: String,
    },
    isbankverified: { type: Boolean, default: false },
    recentTempPics: { type: String },
    prositepic: { type: String },
    links: { type: [String] },
    linkstype: { type: [String] },
    interest: {
      type: [String],
      default: [],
    },
    activeinterest: {
      type: [String],
      default: [],
    },
    puchase_history: [{ type: ObjectId, ref: "Order" }],
    puchase_products: [{ type: ObjectId, ref: "Product" }],
    subscriptions: [{ type: ObjectId, ref: "Subscriptions" }],
    cart_history: {
      type: [String],
      default: [],
    },
    notifications: {
      type: [String],
    },
    location: { type: String },
    isverified: {
      type: Boolean,
      default: false,
    },
    settings: {
      type: [String],
    },
    status: {
      type: String,
      default: "Unblock",
      enum: ["Unblock", "Block"],
      reason: { type: String },
    },
    desc: { type: String, maxLength: 500 },
    shortdesc: { type: String, maxLength: 150 },
    communityjoined: [{ type: ObjectId, ref: "Community", default: [] }],
    muted: [{ type: ObjectId, ref: "Conversation", default: [] }],
    communitycreated: [{ type: ObjectId, ref: "Community", default: [] }],
    totalcom: { type: Number, default: 0 },
    likedposts: [{ type: ObjectId, ref: "Post", default: [] }],
    topicsjoined: [{ type: ObjectId, ref: "Topic", default: [] }],
    totaltopics: { type: Number, default: 0 },
    notifications: [{ type: ObjectId, ref: "Notification" }],
    notificationscount: { type: Number, default: 0 },
    purchasestotal: { type: Number, default: 0 },
    location: { type: String },
    ipaddress: { type: String },
    currentlogin: { type: String },
    popularity: { type: String, default: "0%" },
    totalmembers: { type: Number, default: 0 },
    badgescount: { type: Number, default: 0 },

    currentmoney: { type: Number, default: 0 },
    paymenthistory: [{ type: ObjectId, ref: "Payment" }],
    moneyearned: { type: Number, default: 0 },
    topicearning: { type: Number, default: 0 },//topic
    storeearning: { type: Number, default: 0 },//store
    adsearning: { type: Number, default: 0 },//store
    pendingpayments: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    cart: [{ type: ObjectId, ref: "Cart" }],
    cartproducts: [{ type: ObjectId, ref: "Subscriptions" }],
    web: { type: String },
    prositeid: { type: ObjectId, ref: "Prosite" },
    lastlogin: { type: [String] },
    location: { type: [String] },
    device: { type: [String] },
    accounttype: { type: String },
    organization: { type: String },
    contacts: [{ type: Array }],
    notificationtoken: { type: String },
    sessions: [
      {
        time: { type: String, default: Date.now().toString() },
        screen: { type: String },
        deviceinfo: { type: [Array] },
        location: { type: [Array] },
      },
    ],
    activity: [
      {
        time: { type: String, default: Date.now().toString() },
        type: { type: String },
        deviceinfo: { type: [Array] },
        location: { type: [Array] },
      },
    ],
    blockedcoms: [
      {
        time: { type: String, default: Date.now().toString() },
        comId: { type: ObjectId, ref: "Community" },
      },
    ],
    promotedPosts: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
    }],
    blockedpeople: [
      {
        time: { type: String, default: Date.now().toString() },
        id: { type: ObjectId, ref: "User" },
      },
    ],
    messagerequests: [
      {
        message: { type: String },
        id: { type: ObjectId, ref: "User" },
      },
    ],
    msgrequestsent: [
      {
        id: { type: ObjectId, ref: "User" },
      },
    ],
    conversations: [
      {
        type: String,
        timestamp: new Date(),
      },
    ],
    orders: [
      {
        type: ObjectId,
        ref: "Order",
        status: { type: String },
        timestamp: new Date(),
      },
    ],
    customers: [
      {
        id: { type: String },
      },
    ],
    uniquecustomers: [
      {
        id: { type: String },
      },
    ],
    collectionss: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Collectionss" },
    ],
    adid: { type: Number },
    advertiserid: { type: ObjectId, ref: "Advertiser" },
    address: {
      houseno: { type: String },
      streetaddress: { type: String },
      state: { type: String },
      city: { type: String },
      landmark: { type: String },
      pincode: { type: String },
      country: { type: String },
      coordinates: {
        latitude: { type: Number },
        longitude: { type: Number },
        altitude: { type: Number },
        provider: { type: String },
        accuracy: { type: Number },
        bearing: { type: Number },
      },
    },
    // ayush
    storeAddress: [
      {
        buildingno: { type: String },
        city: { type: String },
        state: { type: String },
        postal: { type: Number },
        landmark: { type: String },
        gst: { type: String },
        businesscategory: { type: String },
        documenttype: { type: String },
        documentfile: { type: String },
        coordinates: {
          latitude: { type: Number },
          longitude: { type: Number },
          altitude: { type: Number },
          provider: { type: String },
          accuracy: { type: Number },
          bearing: { type: Number },
        },
      },
    ],
    showContact: { type: Boolean, default: false },
    totalStoreVisit: { type: Number, default: 0 },
    salesCount: { type: Number, default: 0 },
    storeStats: [
      {
        Dates: { type: String },
        Sales: { type: Number },
      },
    ],
    storeDemographics: {
      age: {
        "18-24": { type: Number, default: 0 },
        "25-34": { type: Number, default: 0 },
        "35-44": { type: Number, default: 0 },
        "45-64": { type: Number, default: 0 },
        "65+": { type: Number, default: 0 },
      },
      gender: {
        male: { type: Number, default: 0 },
        female: { type: Number, default: 0 },
      },
    },
    storeLocation: {
      "andhra pradesh": { type: Number, default: 0 },
      "arunachal pradesh": { type: Number, default: 0 },
      assam: { type: Number, default: 0 },
      bihar: { type: Number, default: 0 },
      chhattisgarh: { type: Number, default: 0 },
      goa: { type: Number, default: 0 },
      gujarat: { type: Number, default: 0 },
      haryana: { type: Number, default: 0 },
      "himachal pradesh": { type: Number, default: 0 },
      jharkhand: { type: Number, default: 0 },
      karnataka: { type: Number, default: 0 },
      kerala: { type: Number, default: 0 },
      "madhya pradesh": { type: Number, default: 0 },
      maharashtra: { type: Number, default: 0 },
      manipur: { type: Number, default: 0 },
      meghalaya: { type: Number, default: 0 },
      mizoram: { type: Number, default: 0 },
      nagaland: { type: Number, default: 0 },
      odisha: { type: Number, default: 0 },
      punjab: { type: Number, default: 0 },
      rajasthan: { type: Number, default: 0 },
      sikkim: { type: Number, default: 0 },
      "tamil nadu": { type: Number, default: 0 },
      telangana: { type: Number, default: 0 },
      tripura: { type: Number, default: 0 },
      "uttar pradesh": { type: Number, default: 0 },
      uttarakhand: { type: Number, default: 0 },
      "west bengal": { type: Number, default: 0 },
    },
    // ---
    mesIds: [{ type: Number }],
    deliverypartners: [
      {
        time: { type: String, default: Date.now().toString() },
        id: { type: ObjectId, ref: "User" },
      },
    ],
    foodLicense: { type: String },
    ismembershipactive: { type: Boolean, default: false },
    dm: { type: Number, default: 0 },
    tagging: { type: Number, default: 0 },
    memberships: {
      membership: { type: ObjectId, ref: "membership" },
      status: { type: Boolean, default: true },
      ending: { type: String },
      paymentdetails: {
        mode: { type: String },
        amount: { type: Number },
        gstamount: { type: Number },
      },
    },
    activeSubscription: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subscriptions",
      },
    ],
    limits: {
      productlimit: { type: Number },
      topiclimit: { type: Number },
      communitylimit: { type: Number },
      collectionlimit: { type: Number },
      // prositelimit: { type: Number }
    },
    isStoreVerified: { type: Boolean, default: false },
    contents: [{ type: String }],
    bank: {
      bankname: { type: String },
      personname: { type: String },
      branchname: { type: String },
      accountno: { type: String },
      IFSCcode: {
        type: String,
      },
    },
    recentProsites: [{
      htmlContent: { type: String },
      canvasImage: { type: String },
      template: { type: Number },
      headline: { type: String },
      description: { type: String },
      backgroundColor: { type: String },
      backgroundImage: { type: String },
      color: { type: String },
      image: { type: String },
      fonts: [{
        fontFamily: { type: String },
        link: { type: String },
        type: { type: String },
        id: { type: ObjectId, ref: "Font" }
      }],
      button: {
        text: { type: String },
        link: { type: String },
        id: { type: ObjectId, ref: "Buttonss" }
      }
    }],

    agencyDetails: {
      iscreatedbyagency: { type: Boolean, default: false },
      agencyuserid: { type: ObjectId, ref: "User" },
      agencyadvertiserid: { type: ObjectId, ref: "Advertiser" }
    },
    showStoreSection: { type: Boolean, default: true },
    showCommunitySection: { type: Boolean, default: true },
    showAboutSection: { type: Boolean, default: true },
    gr: { type: Number, default: 0 },
    useDefaultProsite: { type: Boolean, default: false },
    recentPrositeSearches: [{ type: ObjectId, ref: "User", default: [] }],
    recentCommunitySearches: [{ type: ObjectId, ref: "Community", default: [] }],
    membershipHistory: [{
      id: { type: ObjectId, ref: "Membership" },
      date: { type: Date, default: Date.now }
    }]
    // for workspace membership
  },

  { timestamps: false }
);

userSchema.index({ fullname: "text" });

//virtualfields

userSchema
  .virtual("password")
  .set(function (password) {
    this._password = password;
    this.salt = this.makeSalt();
    this.hashed_password = this.encryptPassword(password);
  })
  .get(function () {
    return this._password;
  });

//virtual methods

userSchema.methods = {
  authenticate: function (plainText) {
    return this.encryptPassword(plainText) === this.hashed_password;
  },

  encryptPassword: function (password) {
    if (!password) return "";
    try {
      return crypto
        .createHmac("sha1", this.salt)
        .update(password)
        .digest("hex");
    } catch (err) {
      return "";
    }
  },
  makeSalt: function () {
    return Math.round(new Date().valueOf() * Math.random()) + "";
  },
};

module.exports = mongoose.model("User", userSchema);
