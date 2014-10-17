
// # Wainwright
// ## Dependencies
var fs = require('fs');
var path = require('path');
var deco = require('deco');
var es = require('event-stream');
var yaml = require('js-yaml');
var mime = require('mime');
var markdown = require('marked');
var gulpmatch = require('gulp-match');
var highlight = require('highlight.js');
var consolidate = require('consolidate');
var htmling = require('htmling');
var File = require('vinyl');
// ## Configuration
// Set up code highlighting for markdown transforms.
markdown.setOptions({
  highlight: function (code) {
    return highlight.highlightAuto(code).value;
  }
});
// ## Private Methods
// From the wintersmith markdown plugin.
function parseMetadata (source, callback) {
  var i;
  var lines;
  var markerPad = '';

  if (!source) return callback(null, {});
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

  // Metadata is defined by either starting and ending line,
  if (content.slice(0, 3) === '---') {
    result = content.match(/^-{3,}\s([\s\S]*?)-{3,}(\s[\s\S]*|\s?)$/);
    if (result && result.length === 3) {
      metadata = result[1];
      body = result[2];
    }
  }
  // or Markdown metadata section at beginning of file.
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
// ## Module Definition
var wainwright = module.exports = function (options) {
  // Merge instance metadata on top of defaults.
  var defaults = { templateDirectory: './templates' };
  var metadata = deco.merge(defaults, options.metadata);
  // A stream to emit the wainwright context for each file.
  var metadataOut = es.through();
  // Build the stream that does all the work.
  var filesOut = es.pipeline(
    wainwright.context(metadata),
    wainwright.extract(),
    wainwright.template(),
    metadataOut,
    wainwright.file()
  );
  // Get the stream of internal data for use by generators.
  // Takes the same arguments as `gulp.src`.
  filesOut.metadata = function (condition) {
    condition = condition || true;
    return metadataOut.pipe(es.through(
      function (metadata) {
        var c = path.resolve(metadata.cwd, metadata.base, condition);
        if (!gulpmatch(metadata, c)) return;
        this.emit('data', metadata);
      },
      function () {
        this.emit('end')
      }
    ));
  };

  return filesOut;
};
// ## Public Methods
// Create initial context from file.
wainwright.context = function (metadata) {
  return es.map(function (file, callback) {
    var body = file.contents ? file.contents.toString() : null;
    callback(null, deco.merge(metadata, {
      cwd: file.cwd,
      base: file.base,
      path: file.path,
      body: body
    }));
  });
};
// Extract the metadata from the file header, if applicable.
wainwright.extract = function () {
  return es.map(function (metadata, callback) {
    // Skip empty files and directories.
    if (!metadata.body) return callback(null, metadata);
    // Handle JSON files specially.  They aren't allowed to
    // have YAML headers.
    if (mime.lookup(metadata.path) === 'application/json') {
      try {
        metadata = deco.merge(metadata, JSON.parse(metadata.body));
      }
      catch (exception) {
        callback(exception);
        return;
      }
      // Ensure metadata path is absolute.
      metadata.path = path.resolve(metadata.cwd, metadata.base, metadata.path);
      callback(null, metadata);
      return;
    }
    // Other files are allowed to specify YAML headers.
    extractMetadata(metadata.body, function (error, extracted) {
      if (error) return callback(error);
      // Merge file metadata over top of instance metadata.
      metadata = deco.merge(metadata, extracted.metadata);
      // Add the file body to the metadata.
      metadata.body = extracted.body;
      // Transform markdown to HTML.
      if (mime.lookup(metadata.path) === 'text/x-markdown') {
        metadata.body = markdown(metadata.body);
        pathParts = metadata.path.split('.');
        pathParts.pop();
        pathParts.push('html');
        metadata.path = pathParts.join('.');
      }
      callback(null, metadata);
    });
  });
};
// Apply template if applicable.
wainwright.template = function () {
  return es.map(function (metadata, callback) {
    // Skip files without template set.
    if (!metadata.template) return callback(null, metadata);
    // First, figure out where the templates are located.
    metadata.template = path.resolve(
      metadata.cwd,
      metadata.templateDirectory,
      metadata.template
    );
    // Choose which template engine to use by matching the
    // file extenstion of the template.
    var extension = metadata.template.split('.').pop();
    // HTMLing support isn't in consolidate :(
    // https://github.com/visionmedia/consolidate.js/pull/162
    if (extension === 'html') {
      fs.readFile(metadata.template, function (error, file) {
        if (error) return callback(error);
        var template = htmling.string(file.toString());
        var bodyTemplate = htmling.string(metadata.body);
        var body = bodyTemplate.render(metadata);
        metadata.rendered = template.render(metadata, body);
        callback(null, metadata);
      });
      return;
    }
    // Otherwise, use consolidate.
    consolidate[extension](metadata.template, metadata, function (error, applied) {
      if (error) return callback(error);
      metadata.rendered = applied;
      // Send the updated file back out e.g. to `gulp.dest`.
      callback(null, metadata);
    });
  });
};
// Convert the wainwright context back into a file.
wainwright.file = function () {
  return es.map(function (metadata, callback) {
    var contents = metadata.rendered || metadata.body;
    if (!contents) contents = null;
    else contents = new Buffer(contents);

    callback(null, new File({
      cwd: metadata.cwd,
      base: metadata.base,
      path: metadata.path,
      contents: contents
    }));
  })
};
