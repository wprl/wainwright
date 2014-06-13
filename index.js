var fs = require('fs');
var path = require('path');
var deco = require('deco');
var es = require('event-stream');
var yaml = require('js-yaml');
var hogan = require('hogan.js');
var xmlb = require('xmlb');
var markdown = require('marked');
var higlight = require('highlight.js');
//
markdown.setOptions({
  highlight: function (code) {
    return higlight.highlightAuto(code).value;
  }
});
// From the wintersmith markdown plugin.
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
  var body = content;

  if (content.slice(0, 3) === '---') {
    result = content.match(/^-{3,}\s([\s\S]*?)-{3,}(\s[\s\S]*|\s?)$/);
    if (result && result.length === 3) {
      metadata = result[1];
      body = result[2];
    }
  } 
  else if (content.slice(0, 12) === '```metadata\n') {
    end = content.indexOf('\n```\n');
    if (end !== -1) {
      metadata = content.substring(12, end);
      body = content.substring(end + 5);
    }
  }

  parseMetadata(metadata, function (error, parsed) {
    if (error) return callback(error);
    callback(null, {
      metadata: parsed,
      body: body
    });
  });
};

function applyTemplate (templatePath, metadata, callback) {
  // load template
  fs.readFile(templatePath, function (error, templateContents) {
    if (error) return callback(error);
    var extension = templatePath.split('.').pop();
    var applied;
    // get tempalte engine based on extension & apply
    if (extension === 'mustache') {
      applied = hogan.compile(templateContents.toString()).render(metadata);
    }
    else if (extension === 'xmlb') {
      applied = xmlb.compile(templateContents.toString())(metadata);
    }
    else {
      return callback(new Error('Unknown template extension.'));
    }

    callback(null, applied);
  });
}

function matchExtension (file) { // TODO use mime module?
  var extensions = Array.prototype.slice.call(arguments, 1);
  var match = false;
  extensions.forEach(function (extension) {
    if (file.path.indexOf(extension) === file.path.length - extension.length) {
      match = true;
    }
  });
  return match;
}

var wainwright = module.exports = function (options) {
  // Merge instance metadata on top of defaults.
  var defaults = { templateDirectory: './templates' };
  var metadata = deco.merge(defaults, options.metadata);
  // Build the stream that does all the work.
  return es.map(function (file, callback) {
    var parsed;
    var pathParts;
    var contents = file.contents.toString();
    // Function to process a file.
    function applyLocals (locals, callback) {
      // Rename the file if a new filename was specified.
      if (locals.filename) {
        file.path = path.resolve(file.base, locals.filename);
      }
      // Pass through files without a template unchanged.
      if (!locals.template) return callback(null, file);
      // Otherwise, apply the template.  But first, figure out
      // where they are located.
      var templatePath = path.resolve(
        process.cwd(), 
        locals.templateDirectory, 
        locals.template
      );
      applyTemplate(templatePath, locals, function (error, applied) {
        if (error) return callback(error);
        file.contents = new Buffer(applied);
        callback(null, file);
      });
    }
    // JSON files can't have YAML headers.
    if (matchExtension(file, '.json')) {
      try {
        parsed = deco.merge(metadata, JSON.parse(contents));
      }
      catch (exception) {
        callback(exception);
        return;
      }
      applyLocals(parsed, callback);
      return;
    }
    // For other files, split out the YAML header and the actual body/content.
    extractMetadata(contents, function (error, extracted) {
      if (error) return callback(error);
      // Merge file metadata over top of instance metadata.
      var locals = deco.merge(metadata, extracted.metadata);
      // Add the file body to the locals.
      locals.body = extracted.body;
      // Transform markdown to HTML.
      if (matchExtension(file, '.md', '.markdown')) {
        locals.body = markdown(locals.body);
        if (!locals.filename) {
          pathParts = file.path.split('.');
          pathParts.pop();
          pathParts.push('html');
          locals.filename = pathParts.join('.');
        }
      }
      applyLocals(locals, callback);
    });
  });
};
