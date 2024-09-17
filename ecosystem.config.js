module.exports = {
	apps: [
		{
			name: "main-app",
			script: "index.js",  // Path to your main app file
			instances: 1,        // Number of instances (use 'cluster' mode if scaling)
			exec_mode: "fork",   // Use 'fork' or 'cluster'
		},
		{
			name: "video-compression-worker",
			script: "./helpers/Worker.js", // Path to the worker file
			instances: 1,                  // Only one worker needed for this
			exec_mode: "fork",
		},
	],
};