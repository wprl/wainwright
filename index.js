var fs = require('fs');
var path = require('path');
var deco = require('deco');
var es = require('event-stream');
var yaml = require('js-yaml');
var hogan = require('hogan.js');
var xmlb = require('xmlb');
// From the wintersmith markdown plugin.  (Thanks.)
function parseMetadata (source, callback) {
  var i;
  var lines;
  var markerPad = '';

  if (source.length === 0) return callback(null, {});

  try {
    return callback(null, yaml.load(source) || {});
  } 
  catch (error) {
    if (error.problem != null && error.problemMark != null) {
      lines = error.problemMark.buffer.split('\n');
      for (i = 0; i < error.problemMark.column; i++) {
        markerPad += ' ';
      }
      error.message = "YAML: " + error.problem + "\n\n" 
        + lines[error.problemMark.line] + "\n" + markerPad + "^\n";
    } 
    else {
      error.message = "YAML Parsing error " + error.message;
    }
    return callback(error);
  }
}
// Also from the wintersmith markdown plugin.
function extractMetadata (content, callback) {
  var end;
  var result;
  var metadata = '';
  var data = content;
  if (content.slice(0, 3) === '---') {
    result = content.match(/^-{3,}\s([\s\S]*?)-{3,}(\s[\s\S]*|\s?)$/);
    if (result && result.length === 3) {
      metadata = result[1];
      data = result[2];
    }
  } 
  else if (content.slice(0, 12) === '```metadata\n') {
    end = content.indexOf('\n```\n');
    if (end !== -1) {
      metadata = content.substring(12, end);
      data = content.substring(end + 5);
    }
  }

  parseMetadata(metadata, function (error, parsed) {
    if (error) return callback(error);
    callback(null, {
      metadata: parsed,
      data: data
    });
  });
};

function applyTemplate (templatePath, body, callback) {
  // load template
  fs.readFile(templatePath, function (error, templateContents) {
    if (error) return callback(error);
    var extension = templatePath.split('.').pop();
    var applied;
    // get tempalte engine based on extension & apply
    if (extension === 'mustache') {
      applied = hogan.compile(templateContents.toString()).render(body);
    }
    else if (extension === 'xmlb') {
      applied = xmlb.compile(templateContents.toString())(body);
    }
    else {
      return callback(new Error('Unknown template extension.'));
    }

    callback(null, applied);
  });
}

var wainwright = module.exports = function (options) {
  var metadata = deco.merge({
    templateDirectory: './templates'
  }, options.metadata);

  return es.map(function (file, callback) {
    extractMetadata(file.contents.toString(), function (error, extracted) {
      if (error) return callback(error);
      // Merge file metadata over top of default metadata.
      var local = deco.merge(metadata, extracted.metadata);
      // Rename the file if a new filename was specified.
      if (local.filename) {
        file.path = file.base + local.filename;
      }
      // Pass through files without a tempalte unchanged.
      if (!local.template) return callback(null, file);
      // Otherwise, apply the template.
      var templatePath = path.resolve(
        process.cwd(), 
        local.templateDirectory, 
        local.template
      );
      applyTemplate(templatePath, extracted.data, function (error, applied) {
        if (error) return callback(error);
        file.contents = new Buffer(applied);
        callback(null, file);
      });
    });
  });
};
