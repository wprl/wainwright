wainwright
==========

A tool for building static sites with gulp.  Inspired by wintersmith.

This module's API is stabilizing but may change.  

Functionality
-------------

 * Parse files with or without YAML headers
 * Apply template using engine(s) of your choice
 * Supports generators (for things like pagination and A/B testing)


 Generators
 ----------

An example of a paginator e.g. for a list of articles generated from static blog entry files.

```javascript
var wainwright = require('wainwright');
var util = require('util');
var path = require('path');
var deco = require('deco');
var es = require('event-stream');

var paginator = module.exports = function (options) {
  var n = 0;
  var metadata = { articles: [] };
  var defaults = {
    template: 'blog/archive.hogan',
    first: 'blog/index.html',
    tail: 'blog/page/%d/index.html',
    templateDirectory: './templates',
    perPage: 3
  };
  options = deco.merge(defaults, options);
  var stream = es.pipeline(
    es.through(
      function (article) {
        n += 1;
        metadata.page = Math.ceil(n / options.perPage);
        metadata.cwd = article.cwd;
        metadata.base = article.base;
        metadata.template = options.template;
        metadata.templateDirectory = options.templateDirectory;
        // Build metadata for paginator page.
        metadata.articles.push(article);
        // The first archive page gets a special path.  The rest
        // use a path based on their page number.
        if (metadata.page === 1) metadata.path = options.first;
        else metadata.path = util.format(options.tail, metadata.page);
        // Set path to absolute path.
        metadata.path = path.resolve(article.cwd, article.base, metadata.path);
        // If not at per-page limit, wait until then.
        if (n % options.perPage !== 0) return;
        // The archive page has been fully built.
        this.emit('data', metadata);
      },
      function () {
        // Emit the last page if necessary and end the stream.
        if (n % options.perPage !== 0) this.emit('data', metadata);
        this.emit('end');
      }
    ),
    // Apply any templates specified by the metadata.
    wainwright.template(),
    // Convert the metadata into an output file.
    wainwright.file()
  );  
  return stream;
};
```

Here's an example gulp task using the paginator.

```javascript
gulp.task('build-html', function () {
  // Create a "wagon" to hold these statics.  You can create multiple "wagons"
  // to use different pipelines for different static file definitions.
  var wagon = wainwright();
  // Apply templates to static file definitions.  By default, `templateDirectory`
  // is set to `./templates`, but can be overridden when creating a wagon.  
  var templated = gulp.src('./content/**/*').pipe(wagon);
  // Write the processed pages to the build directory.
  templated.pipe(gulp.dest('./build'));
  // Generate the blog list pages.  The `metadata` method returns a stream of
  // internal wainwright contexts.  The processed contexts built from the file,
  // its template, and its metadata can be filtered by path using the same
  // syntax as `gulp.src`.
  wagon.metadata('./blog/**/*.html')
    .pipe(paginator())
    .pipe(gulp.dest('./build'));
});
```

©2014 William Riley-Land
