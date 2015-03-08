var gulp = require('gulp');
var args = require('yargs').argv;  //process option parsing
var browserSync = require('browser-sync');
var config = require('./gulpconfig')();
var path = require('path');
var _ = require('lodash');
var del = require('del'); //delete multiple files package
var $ = require('gulp-load-plugins')({lazy: true}); //load gulp plugins as needed 
var port = process.env.PORT || config.defaultPort;

/**
* Setup a help task which lists all tasks.  Make it the default which is run with * * 'gulp'
* Refactored for gulp 4
* Use gulp --tasks or --tasks-simple
*/
//gulp.task('help', $.taskListing);
//gulp.task('default', ['help']);

/**
* Run all js files through jscs and jshint
*/
gulp.task('vet', function () {
    log('Analyzing source files...');
    return gulp
        .src(config.alljs)
        .pipe($.if(args.verbose, $.print()))
        .pipe($.jscs()) //js code style
        .pipe($.jshint())   //js code errors
        .pipe($.jshint.reporter('jshint-stylish', {
            verbose: true
        })) //color code the jshint results
        .pipe($.jshint.reporter('fail'));
});

/**
* Cleans build and temp folders
*/
gulp.task('clean', function (done) {
    var delconfig = [].concat(config.build, config.temp);
    log('Cleaning: ' + $.util.colors.blue(delconfig));
    del(delconfig, done);
});

/**
* Cleans build/fonts folder
*/
gulp.task('clean-fonts', function (done) {
    clean(config.build + 'fonts/**/*.*', done);
});

/**
* Cleans build/images folder
*/
gulp.task('clean-images', function (done) {
    clean(config.build + 'images/**/*.*', done);
});

/**
* Cleans css in temp folder
*/
gulp.task('clean-styles', function (done) {
    clean(config.temp + '**/*.css', done);
});

/**
* Cleans build and temp folders of js and html
*/
gulp.task('clean-code', function (done) {
    var files = [].concat(
        config.temp + '**/*.js',
        config.build + '**/*.html',
        config.build + 'js/**/*.js'
    );
    clean(files, done);
});

/**
* Clean styles, then compile less, then prefix, then send to temp folder
*/
gulp.task('styles', gulp.series('clean-styles', function () {
    log('Compiling less...');
    return gulp
        .src(config.less)
        .pipe($.plumber())  //Fixes stream errors
        .pipe($.less()) //Compiles less to css
        .pipe($.autoprefixer({browsers: ['last 2 versions', '> 5%']}))  //Prefixes css rules for browsers
        .pipe(gulp.dest(config.temp));
}));

/**
* Cleans fonts folder, then moves fonts into the build/fonts folder
*/
gulp.task('fonts', gulp.series('clean-fonts', function() {
    log('Copying fonts...');
    
    return gulp
        .src(config.fonts)
        .pipe(gulp.dest(config.build + 'fonts'));
}));

/**
* Cleans images folder, compresses images, then moves them into the build/fonts folder
*/
gulp.task('images', gulp.series('clean-images', function() {
    log('Copying and compressing images...');
    
    return gulp
        .src(config.images)
        .pipe($.imagemin({optimizationLevel: 4}))
        .pipe(gulp.dest(config.build + 'images'));
}));

/**
* Watch task which recompiles styles.less after change
*/
gulp.task('less-watch', function () {
    gulp.watch([config.less], ['styles']);
});

/**
* Cleans build and temp of js and html, then creates an Angular template cache 
*/
gulp.task('templateCache', gulp.series('clean-code', function () {
    log('Creating Angular template cache');
    
    return gulp
        .src(config.htmlTemplates)
        .pipe($.minifyHtml({empty: true}))  //minimizes html, option ignores empty tags
        .pipe($.angularTemplatecache(
            config.templateCache.file,
            config.templateCache.options))  //Concatenates and registers AngularJS templates in the $templateCache
        .pipe(gulp.dest(config.temp));
})
);

/**
* Puts bower dependencies and js files into html source
*/
gulp.task('wiredep', function () {
    log('Wire bower js and app js into html');
    var options = config.getWiredepOptions();
    var wiredep = require('wiredep').stream;
    
    return gulp
        .src(config.index)
        .pipe(wiredep(options)) //bower components
        .pipe($.inject(gulp.src(config.js))) //js files
        .pipe(gulp.dest(config.client));
});

/**
* Puts css, bower dependencies, and js files into html source.  Also runs templateCache
*/
gulp.task('inject', gulp.series(
    gulp.parallel('wiredep', 'styles', 'templateCache'),
    function () {
        log('Called wiredep and styles, wire css into html');

        return gulp
            .src(config.index)
            .pipe($.inject(gulp.src(config.css)))
            .pipe(gulp.dest(config.client));
    })
         );

/**
* Run tests once.
*/
gulp.task('test', gulp.series(
    gulp.parallel('vet', 'templateCache'), function(done) {
    startTests(true, done);
}));

/**
* Prepare files and test for production
*/
gulp.task('optimize', gulp.series(
    gulp.parallel('inject', 'test'), function () {
        log('Optimizing files...');

        var assets = $.useref.assets({searchPath: './'});
        var templateCache = config.temp + config.templateCache.file;
        var cssFilter = $.filter('**/*.css');
        var jsLibFilter = $.filter('**/' + config.optimized.lib);
        var jsAppFilter = $.filter('**/' + config.optimized.app);

        return gulp
            .src(config.index)
            .pipe($.plumber())
            .pipe($.inject(gulp.src(templateCache, {read: false}), {
                starttag: '<!-- inject:templates:js -->'
            }))  //Injects template cache into index.html
            .pipe(assets)  //concatenates the source files inside <!-- build --> comments
            .pipe(cssFilter)  //filters to get just the css files
            .pipe($.csso())  //optimizes css files
            .pipe(cssFilter.restore())  //puts all the files back in the stream
            .pipe(jsLibFilter)  //filters to get just the js files
            .pipe($.uglify())  //uglifies the js files
            .pipe(jsLibFilter.restore())  //puts all the files back in the stream
            .pipe(jsAppFilter)  //filters to get just the app.js file
            .pipe($.ngAnnotate())  //adds dependency injection annotations to prevent dependency loss upon uglify
            .pipe($.uglify())  //uglifies app.js
            .pipe(jsAppFilter.restore())  //puts all the files back in the stream
            .pipe($.rev())  //creates revisioned file names
            .pipe(assets.restore())  //restore the filtered out html files
            .pipe($.useref())  //pass the files down the stream
            .pipe($.revReplace())  //replace files with new revisions
            .pipe(gulp.dest(config.build))
            .pipe($.rev.manifest())  //creates a manifest of revised filenames
            .pipe(gulp.dest(config.build));

    })
);

/**
* Build files for production
*/
gulp.task('build', gulp.series(
    gulp.parallel('optimize', 'images', 'fonts'),
    function (done) {
        log('Building app');

        var msg = {
            title: 'gulp build',
            subtitle: 'Deployed to the build folder',
            message: 'Running `gulp serve-build`'
        };
        del(config.temp);
        log(msg);
        notify(msg);
        done();
    })
);

/**
* Injects all the needed files in spec.html for Mocha to run
*/
gulp.task('build-specs', gulp.series('templateCache', function() {
    log('building the spec runner');
    
    var wiredep = require('wiredep').stream;
    var options = config.getWiredepOptions();
    var specs = config.specs;
    
    options.devDependencies = true;
    
    if (args.startServers) {
        specs = [].concat(specs, config.serverIntegrationSpecs);
    }
    
    return gulp
        .src(config.specRunner)
        .pipe(wiredep(options))
        .pipe($.inject(gulp.src(config.testlibraries),
            {name: 'inject:testlibraries', read: false}))
        .pipe($.inject(gulp.src(config.js)))
        .pipe($.inject(gulp.src(config.specHelpers),
            {name: 'inject:spechelpers', read: false}))
        .pipe($.inject(gulp.src(specs),
            {name: 'inject:specs', read: false}))
        .pipe($.inject(gulp.src(config.temp + config.templateCache.file),
            {name: 'inject:templates', read: false}))
        .pipe(gulp.dest(config.client));
}));

/**
* Start the Mocha test runner
*/
gulp.task('serve-specs', gulp.series('build-specs', function (done) {
    log('Running the spec runner');
    serve(true, true);
    done();
}));

/**
* Increments version number.
* --type-pre will increment the prerelease version *.*.*-x
* --type-patch will increment the patch version *.*.x
* --type-minor will increment the minor version *.x.*
* --type-major will increment the major version x.*.*
* --version will set to specified version 1.2.3
*/
gulp.task('bump', function() {
    var msg = 'Incrementing versions';
    var type = args.type;
    var version = args.version;
    var options = {};
    if (version) {
        options.version = version;
        msg += ' to ' + version;
    } else {
        options.type = type;
        msg += ' for a ' + type;
    }
    log(msg);
    return gulp
        .src(config.packages)
        .pipe($.print())
        .pipe($.bump(options))
        .pipe(gulp.dest(config.root));
});

/**
* Serve files for production.
*/
gulp.task('serve-build', gulp.series('build', function() {
    serve(false);
}));

/**
* Serve files for development.
*/
gulp.task('serve-dev', gulp.series('inject', function () {
    serve(true);
}));

/**
* Run tests repeatedly.
*/
gulp.task('autotest', gulp.series(
    gulp.parallel('vet', 'templateCache'), function(done) {
    startTests(false, done);
}));

//------------------------------//

/**
 * Serves the application
 * @param {boolean} isDev Is this serving development(true) or production(false)
 * @param {boolean} specRunner Is this serving the test specRunner
 */

function serve(isDev, specRunner) {
    
    var nodeOptions = {
        script: config.nodeServer,
        delayTime: 1,
        env: {
            'PORT': port,
            'NODE_ENV': isDev ? 'dev' : 'build'
        },
        watch: [config.server]
    };
    
    return $.nodemon(nodeOptions)
        .on('restart', function (ev) {
            log('NODEMON RESTARTED');
            log('FILES CHANGED:\n' + ev);
            setTimeout(function() {
                browserSync.notify('reloading browsers...');
                browserSync.reload({stream: false});
            }, config.browserReloadDelay);
        })
        .on('start', function () {
            log('NODEMON STARTED');
            startBrowserSync(isDev, specRunner);
        })
        .on('crash', function () {
            log('NODEMON CRASHED');
        })
        .on('exit', function () {
            log('NODEMON EXIT');
        });
}

/**
 * Nicely log changed files
 * @param {Object} event The changed file
 */

function changeEvent(event) {
    var srcPattern = new RegExp('/.*(?=/' + config.source + ')/');
    log('File ' + event.path.replace(srcPattern, '') + ' ' + event.type + ' fool');
}

function notify(options) {
    var notifier = require('node-notifier');
    var notifyOptions = {
        sound: 'Bottle',
        contentImage: path.join(__dirname, 'gulp.png'),
        icon: path.join(__dirname, 'gulp.png')
    };
    _.assign(notifyOptions, options);
    notifier.notify(notifyOptions);
}

/**
 * Starts BrowserSync
 * @param {boolean} isDev Is this serving development(true) or production(false)
 * @param {boolean} specRunner Is this serving the test specRunner
 */

function startBrowserSync(isDev, specRunner) {
    if (args.nosync || browserSync.active) {
        return;
    }
    
    log('Starting Browser Sync on port ' + port);
    
    if (isDev) {
        gulp.watch([config.less], ['styles'])
        .on('change', function (event) {
            changeEvent(event);
        });  
    } else {
        gulp.watch([config.less, config.js, config.html], ['optimize', browserSync.reload])
        .on('change', function (event) {
            changeEvent(event);
        });
    }
    
    
    var options = {
        proxy: 'localhost:' + port,
        port: 3000,
        files: isDev ? [
            config.client + '**/*.*',
            '!' + config.less,
            config.temp + '**/*.css'
        ] : [],
        ghostMode: {
            clicks: true,
            location: true,
            forms: true,
            scroll: true
        },
        injectChanges: true,
        logFileChanges: true,
        logLevel: 'debug',
        logPrefix: 'gulp-patterns',
        notify: true,
        reloadDelay: 1000
    };
    
    if (specRunner) {
        options.startPath = config.specRunnerFile;
    }
    
    browserSync(options);
}

/**
 * Start karma tests
 * @param {Boolean}  singleRun Is this a single run test
 * @param {Function} done  Callback function
 */

function startTests(singleRun, done) {
    var child;
    var fork = require('child_process').fork;
    var karma = require('karma').server;
    var excludeFiles = [];
    var serverSpecs = config.serverIntegrationSpecs;
    
    if (args.startServers) {
        log('Starting server');
        var savedEnv = process.env;
        savedEnv.NODE_ENV = 'dev';
        savedEnv.PORT = 8888;
        child = fork(config.nodeServer);
    } else {
        if (serverSpecs && serverSpecs.length) {
            excludeFiles = serverSpecs; 
        }
    }
    
    karma.start({
        configFile: __dirname + '/karma.conf.js',
        exclude: excludeFiles,
        singleRun: !!singleRun
    }, karmaCompleted);
    
    function karmaCompleted(karmaResult) {
        log('Karma completed');
        if (child) {
            log('Shutting down the child process');
            child.kill();
        }
        if (karmaResult === 1) {
            done('karma: tests failed with code ' + karmaResult);
        } else {
            done();
        }
    }
}

/**
 * Clean given path of files and folders
 * @param {String}   path The path tok be cleaned
 * @param {Function} done The callback function
 */

function clean(path, done) {
    log('Cleaning: ' + $.util.colors.blue(path));
    del(path, done);
}

/**
 * Nice logging
 * @param {String} msg Tell me what to log yo
 */

function log(msg) {
    if (typeof (msg) === 'object') {
        for (var item in msg) {
            if (msg.hasOwnProperty(item)) {
                $.util.log($.util.colors.blue(msg[item]));
            }
        }
    } else {
        $.util.log($.util.colors.blue(msg));
    }
}
