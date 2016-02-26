var chalk = require('chalk');
var Bluebird = require('bluebird');
var request = require('request');
var fs = require('fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var ncp = require('ncp');
var path = require('path');
var targz = require('tar.gz');
var debug = require('debug')('ember-fastboot-deploy');
var FastBootServer = require('ember-fastboot-server');

function FastBootDeploy(options) {
  this.deploySecret = options.deploySecret;
  this.s3BucketUrl = options.s3BucketUrl;
  this.distPath = options.distPath;

  if (fs.existsSync(path.join(options.distPath, 'package.json'))) {
    this.fastbootServer = new FastBootServer({ distPath: options.distPath });
  } else if (!fs.existsSync(options.distPath)) {
    mkdirp.sync(options.distPath);
  }
}

function requestGetFile(url, filePath) {
  return  new Bluebird.Promise(function(resolve, reject) {
    var output = fs.createWriteStream(filePath);
    output.on('finish', function (){
      resolve();
    });
    output.on('error', function (error){
      reject(error);
    });
    request.get(url).pipe(output);
  });
}

FastBootDeploy.prototype.fastbootServerMiddleware = function() {
  return function(req, res, next) {
    if (req.query.noFastboot) {
      next();
    } else if (this.fastbootServer) {
      return this.fastbootServer.middleware()(req, res, next);
    } else {
      return res.send(
        '<html>'+
          '<body>' +
            'No Ember application has been deployed to the FastBoot server.' +
          '</body>' +
        '</html>'
      );
    }
  }.bind(this);
};

FastBootDeploy.prototype.deployMiddleware = function() {
  return [require('express-force-ssl'), function(req, res, next) {
    if (req.query.secret !== this.deploySecret) { return res.status(403).end(); }

    var self = this;
    var pkgName = req.query.pkgName;
    self.log('green', 'Starting deploy for pkg ' + pkgName);

    var pkgUrl = self.s3BucketUrl + '/' + pkgName;
    var pkgDir = path.join('tmp', pkgName.replace(/\./g, '_'));
    var pkgFile = path.join(pkgDir, pkgName);
    if (!fs.existsSync(pkgDir)) { fs.mkdirSync(pkgDir); } //TODO do a better job making sure this is clean first

    self.log('green', 'Downloading fastboot package ' + pkgUrl);
    return requestGetFile(pkgUrl, pkgFile).then(function(){
      self.log('green', 'Unzipping fastboot package to ' + pkgDir);
      return targz().extract(pkgFile, pkgDir);
    }).then(function() {
      return new Bluebird.Promise(function(resolve, reject) {
        rimraf(self.distPath + '/*', function(error) {
          if (error) { reject(error); } else { resolve(); }
        });
      });
    }).then(function() {
      self.log('green', 'Copying contents of ' + pkgDir + ' to ' + self.distPath);
      return new Bluebird.Promise(function(resolve, reject) {
        ncp(path.join(pkgDir, 'fastboot-dist'), self.distPath, function(error) {
          if (error) { reject(error); } else { resolve(); }
        });
      });
    }).then(function() {
      self.log('green', 'Creating new fastboot middleware from dist folder: ' + self.distPath);
      self.fastbootServer = new FastBootServer({ distPath: self.distPath });
      return res.status(204).end();
    }).catch(function(error) {
      self.log('red', error.stack);
      next(error);
    });
  }.bind(this)];
};

FastBootDeploy.prototype.log = function(color, message) {
  var now = new Date();
  console.log(chalk.blue(now.toISOString()) + chalk.bold(" FastbootDeploy: ") + chalk[color](message));
};

module.exports = FastBootDeploy;
