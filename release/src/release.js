/* ----------------------------------------------------------
 * 打包入口文件，使用方式
 * × 指定打包配置文件
 *   > node release/src/release.js config=d:/test/blog.conf
 * × 配置文件为release/release.conf
 *   > node release/src/release.js
 * ----------------------------------------------------------
 */
// require module
var __result = {},
    _util    = require('./util.js'),
    _path    = require('./path.js'),
    _config  = require('./config.js'),
    _parser  = require('./parser.js'),
     query   = require('querystring');
/*
 * 取命令行参数
 * @return {Object} 命令行参数
 */
var __getArgs = (function(){
    var _args;
    return function(){
        if (!_args){
            var _arr = process.argv.slice(2);
            _args = query.parse(_arr.join('&'));
        }
        return _args;
    };
})();
/*
 * 取配置文件路径
 * @return {String} 配置文件路径
 */
var __getConfPath = function(){
    var _args = __getArgs();
    return _args['-c']||
           _args['--config']||
           _args.config||'./release.conf';
};
// parse config file
var _conf = __getConfPath();
// a/b/release.conf relative to current directory
if (/^[\w]/.test(_conf)&&_conf.indexOf(':')<0)
    _conf =  process.cwd()+'/'+_conf;
_config.parse(_path.path(_conf,__dirname+'/'));
// parse project
_parser.html(_config.get('DIR_SOURCE'),__result);
_parser.template(_config.get('DIR_SOURCE_TP'),__result);
__result.ondownload = function(){
    _parser.cs(__result);
    _parser.js(__result);
    _parser.output(__result);
};
_parser.download(__result);