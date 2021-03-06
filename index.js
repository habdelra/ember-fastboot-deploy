var chalk = require('chalk');
var Bluebird = require('bluebird');
var request = require('request');
var fs = require('fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var ncp = require('ncp');
var path = require('path');
var targz = require('targz');
var debug = require('debug')('ember-fastboot-deploy');
var FastBootServer = require('ember-fastboot-server');

function FastBootDeploy(options) {
  var distPath = options.distPath || 'tmp/current-fastboot-dist';
  this.deploySecret = options.deploySecret;
  this.s3BucketUrl = options.s3BucketUrl;
  this.distPath = distPath;
  this.afterDeploy = options.afterDeploy;

  if (fs.existsSync(path.join(distPath, 'package.json'))) {
    this.fastbootServer = new FastBootServer({ distPath: distPath });
  } else if (options.fastbootPkgName) {
    this._deployPackage(options.fastbootPkgName);
  } else if (!fs.existsSync(distPath)) {
    mkdirp.sync(distPath);
  }
}

function requestGetFile(url, filePath) {
  return  new Bluebird.Promise(function(resolve, reject) {
    request.get(url)
    .on('response', function(response) {
      if (response.statusCode !== 200) { reject(new Error('Could not download fastboot package, HTTP response was ' +
                                                          response.statusCode + ' ' +
                                                          response.statusMessage)); }
    })
      .on('error', function (error){
        reject(error);
      })
      .pipe(fs.createWriteStream(filePath))
      .on('finish', function() {
        resolve();
      });
  });
}

FastBootDeploy.prototype._deployPackage = function(pkgName, isClientRequestedDeploy) {
  var self = this;
  self.log('green', 'Starting deploy for pkg ' + pkgName);

  var pkgUrl = self.s3BucketUrl + '/' + pkgName;
  var pkgDir = path.join('tmp', pkgName.replace(/\./g, '_'));
  var pkgFile = path.join(pkgDir, pkgName);
  if (!fs.existsSync(pkgDir)) { mkdirp.sync(pkgDir); } //TODO do a better job making sure this is clean first

  self.log('green', 'Downloading fastboot package ' + pkgUrl);
  return requestGetFile(pkgUrl, pkgFile).then(function(){
    if (!fs.existsSync(pkgFile)) { throw new Error('no fastboot package in s3'); }
    self.log('green', 'Unzipping fastboot package to ' + pkgDir);
    return new Bluebird.Promise(function(resolve, reject) {
      targz.decompress({
        src: pkgFile,
        dest: pkgDir
      }, function(error) {
        if (error) { reject(error); } else { resolve(); }
      });
    });
  }).then(function() {
    return new Bluebird.Promise(function(resolve, reject) {
      rimraf(self.distPath + '/*', function(error) {
        if (error) { reject(error); } else { resolve(); }
      });
    });
  }).then(function() {
    self.log('green', 'Copying contents of ' + pkgDir + ' to ' + self.distPath);
    mkdirp.sync(self.distPath);
    return new Bluebird.Promise(function(resolve, reject) {
      ncp(path.join(pkgDir, 'deploy-dist'), self.distPath, function(error) {
        if (error) { reject(error); } else { resolve(); }
      });
    });
  }).then(function() {
    self.log('green', 'Creating new fastboot middleware from dist folder: ' + self.distPath);
    self.fastbootServer = new FastBootServer({ distPath: self.distPath });
    if (typeof self.afterDeploy === 'function') { self.afterDeploy(isClientRequestedDeploy); }
  }).catch(function(error) {
    self.log('red', error);
  });
};

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
  return function(req, res, next) {
    // Don't allow unsecured requests to this route. In the case where you are being forwarded from SSL terminated
    // in heroku check the "x-forwarded-proto" header that the heroku router sets. Are there other headers like this?
    if (req.protocol !== 'https' && req.headers['x-forwarded-proto'] !== 'https') {
      return res.status(403).send('Deploy request must be issued using HTTPS').end();
    }
    if (req.query.secret !== this.deploySecret) { return res.status(403).send('Deploy secret is is invalid').end(); }

    var self = this;
    var pkgName = req.query.pkgName;
    return self._deployPackage(pkgName, true).then(function() {
      self.log('green', 'Creating new fastboot middleware from dist folder: ' + self.distPath);
      return res.status(200).send('Deployed package ' + pkgName + ' successfullfy.').end();
    }).catch(function(error) {
      self.log('red', error.stack);
      next(error);
    });
  }.bind(this);
};

FastBootDeploy.prototype.log = function(color, message) {
  var now = new Date();
  console.log(chalk.blue(now.toISOString()) + chalk.bold(" FastbootDeploy: ") + chalk[color](message));
};

module.exports = FastBootDeploy;
