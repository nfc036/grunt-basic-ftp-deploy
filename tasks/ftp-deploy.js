//
// Grunt Task File
// ---------------
//
// Task: FTP Deploy
// Description: Deploy code over FTP
// Dependencies: jsftp
//

module.exports = function (grunt) {

  grunt.util = grunt.util || grunt.utils;

  var async = require('async');
  var log = grunt.log;
  var verbose = grunt.verbose;
  var _ = require('lodash');
  var file = grunt.file;
  var fs = require('fs');
  var path = require('path');
  var Ftp = require('basic-ftp');
  var prompt = require('prompt');

  var toTransfer;
  var ftpClient;
  var localRoot;
  var remoteRoot;
  var currPath;
  var authVals;
  var exclusions;
  var forceVerbose;

  // A method for parsing the source location and storing the information into a suitably formated object
  function dirParseSync (startDir, result) {
    var files;
    var i;
    var tmpPath;
    var currFile;

    // initialize the `result` object if it is the first iteration
    if (result === undefined) {
      result = {};
      result[path.sep] = [];
    }

    // check if `startDir` is a valid location
    if (!fs.existsSync(startDir)) {
      grunt.warn(startDir + ' is not an existing location');
    }

    // iterate throught the contents of the `startDir` location of the current iteration
    files = fs.readdirSync(startDir);
    for (i = 0; i < files.length; i++) {
      currFile = startDir + path.sep + files[i];
      if (!file.isMatch({matchBase: true}, exclusions, currFile)) {
        if (file.isDir(currFile)) {
          tmpPath = path.relative(localRoot, startDir + path.sep + files[i]);
          if (!_.has(result, tmpPath)) {
            result[tmpPath] = [];
          }
          dirParseSync(startDir + path.sep + files[i], result);
        } else {
          tmpPath = path.relative(localRoot, startDir);
          if (!tmpPath.length) {
            tmpPath = path.sep;
          }
          result[tmpPath].push(files[i]);
        }
      }
    }

    return result;
  }

  // A method for changing the remote working directory and creating one if it doesn't already exist
  async function ftpCwd (inPath, cb) {
    await ftpClient.ensureDir(inPath);
    await ftpClient.cd(inPath);
    cb(null);
  }

  // A method for uploading a single file
  async function ftpPut (inFilename, done) {
    var fpath = path.normalize(localRoot + path.sep + currPath + path.sep + inFilename);
    await ftpClient.uploadFrom(fpath, inFilename);
    if (forceVerbose) {
      log.ok('Uploaded file: ' + inFilename.green + ' to: ' + currPath.yellow);
    } else {
      verbose.ok('Uploaded file: ' + inFilename.green + ' to: ' + currPath.yellow);
    }
    done(null);
  }

  // A method that processes a location - changes to a folder and uploads all respective files
  function ftpProcessLocation (inPath, cb) {
    if (!toTransfer[inPath]) {
      cb(new Error('Data for ' + inPath + ' not found'));
    }

    ftpCwd(path.normalize('/' + remoteRoot + '/' + inPath).replace(/\\/gi, '/'), function (err) {
      var files;

      if (err) {
        grunt.warn('Could not switch to remote folder!');
      }

      currPath = inPath;
      files = toTransfer[inPath];

      async.eachSeries(files, ftpPut, function (err) {
        if (err) {
          grunt.warn('Failed uploading files!');
        }
        cb(null);
      });
    });
  }

  function getAuthVals(inAuth) {
    var tmpData;
    var authFile = path.resolve(inAuth.authPath || '.ftppass');

    // If authentication values are provided in the grunt file itself
    var username = inAuth.username;
    var password = inAuth.password;
    if (typeof username != 'undefined' && username != null && typeof password != 'undefined' && password != null) return {
      username: username,
      password: password
    };

    // If there is a valid auth file provided
    if (fs.existsSync(authFile)) {
      tmpData = JSON.parse(grunt.file.read(authFile));
      if (inAuth.authKey) return tmpData[inAuth.authKey] || {};
      if (inAuth.host) return tmpData[inAuth.host] || {};
    } else if (inAuth.authKey) grunt.warn('\'authKey\' configuration provided but no valid \'.ftppass\' file found!');

    return {};
  }

  // The main grunt task
  grunt.registerMultiTask('ftp-deploy', 'Deploy code over FTP', async function () {
    var done = this.async();

    // Init
    ftpClient = new Ftp.Client();
    ftpClient.ftp.verbose = true;

    localRoot = Array.isArray(this.data.src) ? this.data.src[0] : this.data.src;
    remoteRoot = Array.isArray(this.data.dest) ? this.data.dest[0] : this.data.dest;
    authVals = getAuthVals(this.data.auth);
    exclusions = this.data.exclusions || [];
//    ftp.useList = true;
    toTransfer = dirParseSync(localRoot);
    forceVerbose = this.data.forceVerbose === true ? true : false;

    // Getting all the necessary credentials before we proceed
    var needed = {properties: {}};
    if (!authVals.username) needed.properties.username = {};
    if (!authVals.password) needed.properties.password = {hidden:true};
    prompt.get(needed, async function (err, result) {
      if (err) {
        grunt.warn('Authentication ' + err);
      }
      if (result.username) authVals.username = result.username;
      if (result.password) authVals.password = result.password;

      // Authentication and main processing of files
      try {
        await ftpClient.access({
          host: this.data.auth.host,
          user: authVals.username,
          password: authVals.password,
          secure: false
          });
        var locations = _.keys(toTransfer);

        // Iterating through all location from the `localRoot` in parallel
        async.eachSeries(locations, ftpProcessLocation, function () {
          log.ok('FTP upload done!');
          done();
        });
      } catch (err) {
        log.error(err);
      }
      ftpClient.close();

      if (grunt.errors) {
        return false;
      }
    });
  });
};
