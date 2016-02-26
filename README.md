# ember-fastboot-deploy
Node Express middleware to deploy Ember applications into a FastBoot server

This middleware is used to receive deployment notifications from the ember-cli-deploy pipeline. The idea is that in your Ember app, you can setup an ember-cli-deploy pipeline that:

1. Performs a FastBoot build `ember-cli-fastboot-build`
2. Zips up the FastBoot build artifacts `ember-cli-deploy-archive`
3. Uploads the FastBoot zip to S3 `ember-cli-deploy-s3`
4. Sends a notitication to the FastBoot server that a new zip is available to be deployed `ember-cli-deploy-notifications`
 
This middleware is responsible for recieving the notification from the last step above, downloading the zip file from S3, unzipping it on the FastBoot server's filesystem, and then restarting the internally managed Ember application that runs within FastBoot.

As the clients issue requests to the FastBoot, this middleware is responsible for returning the middleware function for the most recently deployed Ember application. Additionally, clients can include a `&nofastboot` query parameter to passthru the fastboot middleware to the middleware that appears after this middleware for scenarios when you don't want to serve FastBoot HTML.

Here is an example FastBoot server that uses the FastBoot Deploy middleware:

```js
var express = require('express');
var fs = require('fs');
var https = require('https');
var FastBootDeploy = require('ember-fastboot-deploy');

var fastbootDeploy = new FastBootDeploy({
  deploySecret: process.env.FASTBOOT_DEPLOY_SECRET,
  s3BucketUrl: process.env.FASTBOOT_PKG_S3_BUCKET_URL,
  distPath: 'tmp/current-fastboot-dist'
});

var app = express();

app.get('/deploy', fastbootDeploy.deployMiddleware());

app.get('/*', fastbootDeploy.fastbootServerMiddleware());

// A hypothetical example of how you would setup middleware for serving the index.html from another source
// like Redis. Use `&nofastboot` query param to passthrough to the serveIndexHtmlFromRedis middleware
//
// app.get('/*', fastbootDeploy.fastbootServerMiddleware(), serveIndexHtmlFromRedis);

var options = {
  key: fs.readFileSync('ssl-key.pem'),
  cert: fs.readFileSync('ssl-cert.pem')
};

var listener = https.createServer(options, app).listen(process.env.PORT || 3000, function() {
  var host = listener.address().address;
  var port = listener.address().port;
  console.log('FastBoot running at https://' + host + ":" + port);
});

```
(Note that this FastBoot Deploy middleware requires that the `/deploy` route run in HTTPS for security reasons--other routes do not have to run in HTTPS if you don't want them to).

## FastBoot Server Setup

Using this middleware is pretty straight 

## Ember Application Deployment Configuration 
