# ember-fastboot-deploy
Node Express middleware to deploy Ember applications into a FastBoot server

This middleware is used to receive deployment notifications from the ember-cli-deploy pipeline. The idea is that in your Ember app, you can setup an ember-cli-deploy pipeline that:

1. Performs a FastBoot build `ember-cli-fastboot-build`
2. Zips up the FastBoot build artifacts `ember-cli-deploy-archive`
3. Uploads the FastBoot zip to S3 `ember-cli-deploy-s3`
4. Sends a notitication to the FastBoot server that a new zip is available to be deployed `ember-cli-deploy-notifications`
 
This middleware is responsible for recieving the notification from the last step above, downloading the zip file from S3, unzipping it on the FastBoot server's filesystem, and then restarting the internally managed Ember application that runs within FastBoot.

As the clients issue requests to the FastBoot, this middleware is responsible for returning the middleware function for the most recently deployed Ember application. Additionally, clients can include a `&nofastboot` query parameter to passthru the fastboot middleware to the middleware that appears after this middleware for scenarios when you don't want to serve FastBoot HTML.

The deployment request that is issued to this middleware must be issued using HTTPS, and is of the form:
```
https://youserver.com/deploy?secret=YUr_Sup3R_s3crEts&pkgName=fastboot-build-1456527258931.tar.gz
```
where `secret` is your deployment secret, and `pkgName` is the name of the FastBoot build zip file living on s3 that you wish to deploy.

## FastBoot Server Setup

Here is an example FastBoot server that uses the FastBoot Deploy middleware:

```js
var express = require('express');
var fs = require('fs');
var https = require('https');
var FastBootDeploy = require('ember-fastboot-deploy');

var fastbootDeploy = new FastBootDeploy({
  deploySecret: process.env.FASTBOOT_DEPLOY_SECRET,
  s3BucketUrl: process.env.FASTBOOT_PKG_S3_BUCKET_URL
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

In order to use this middleware you will need to provide the following parameters to the FastBootDeploy function: 

1. `deploySecret` This is a secret value that the deployment notification request that is issued from the `ember-cli-deploy-notifications` pipeline build step must include. It is recommended you set this as an enviroment variable as it is a sentitive value.
2. `s3BucketUrl` This is the URL from which you can access assets of the s3 bucket that contains your FastBoot build zip file. e.g. `https://s3.amazonaws.com/my-s3-bucket`

## Ember Application Deployment Configuration 

In order to leverage this middleware for deploying your Ember application to the FastBoot server, you need to setup your Ember application to perform all the deployment steps outlined at the top of this README. The following ember-cli-deploy addons should be installed for a setup where you want to host your application assets in S3 and use FastBoot to serve your index.html:

* `ember-cli-deploy`
* `ember-cli-deploy-archive` (At the time of this writing you'll need to use this PR specficially: https://github.com/elidupuis/ember-cli-deploy-archive/pull/2)
* `ember-cli-deploy-display-revisions`
* `ember-cli-deploy-fastboot-build`
* `ember-cli-deploy-gzip`
* `ember-cli-deploy-manifest`
* `ember-cli-deploy-notifications`
* `ember-cli-deploy-revision-data`
* `ember-cli-deploy-s3`

You can then setup your Ember application's `config/deploy.js` like this:

```js
var VALID_DEPLOY_TARGETS = [ //update these to match what you call your deployment targets
  'dev',
  'staging',
  'prod'
];

module.exports = function(deployTarget) {
  var timestamp = (new Date()).getTime();
  var fastbootDeploySecret = process.env.FASTBOOT_DEPLOY_SECRET;
  var fastbootArchiveName = 'fastboot-build-' + timestamp + '.tar.gz';
  var filePattern = "**/*.{js,css,png,gif,ico,jpg,map,xml,txt,svg,swf,eot,ttf,woff,woff2,gz,json}";
  var ENV = {
    'fastboot-build': {},
    s3: {
      filePattern: filePattern
    },
    archive: {
      addToDistFiles: true,
      archiveName: function() {
        return fastbootArchiveName;
      }
    },
    gzip: {
      ignorePattern:'**/assetMap.json'
    },
    manifest: {
      filePattern: filePattern
    },
    notifications: {
      services: {
        fastbootServer: {
          url: 'https://my-app.com/deploy?secret=' +
               fastbootDeploySecret + '&pkgName=' + fastbootArchiveName,
          method: 'GET',
          headers: {},
          body: {},
          didActivate: true
        }
      }
    }
  };
  if (VALID_DEPLOY_TARGETS.indexOf(deployTarget) === -1) {
    throw new Error('Invalid deployTarget ' + deployTarget);
  }

  if (deployTarget === 'dev') {
    ENV['fastboot-build'].environment = 'development';
  }

  if (deployTarget === 'staging' || deployTarget === 'prod') {
    ENV['fastboot-build'].environment = deployTarget;
    ENV.s3.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    ENV.s3.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  }

  if (deployTarget === 'staging') {
    ENV.s3.bucket = 'my-app-assets';
    ENV.s3.region = 'us-east-1';
  }
  if (deployTarget === 'prod') {
    //TODO
  }

  return ENV;
}
```  

(for your development environment it might be useful to use a self-signed cert, in that case you can add this you your deploy.js)
```js
  //ignoring self signed certs for dev--REMOVE THIS!!
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
```




