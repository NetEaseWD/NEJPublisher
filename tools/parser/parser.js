var  fs     = require('fs'),
     query   = require('querystring'),
     _iconv = require('../../iconv-lite/index.js');;
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
/**
 * 读取文件内容
 * @param  {String} _file    文件路径
 * @param  {String} _charset 文件编码，默认utf-8，支持gbk
 * @return {Array}           文件内容，按行分隔
 */
var __doReadFile = (function(){
    var _reg = /\r\n|\r|\n/;
    return function(_file,_charset){
        try{
            _charset = _charset||'utf-8';
            var _content = '';
            if (_charset=='utf-8'){
                _content = fs.readFileSync(_file,_charset);
            }else{
                var _buffer = fs.readFileSync(_file);
                _content = _iconv.decode(_buffer,_charset);
            }
            return _content.split(_reg);
        }catch(e){
            return null;
        }
    };
})();
/**
 * 写文件
 * @param  {String} _file    文件路径
 * @param  {String} _content 文件内容
 * @param  {String} _charset 文件编码，默认utf-8，支持gbk
 * @return {Void}
 */
var __doWriteFile = function(_file,_content,_charset){
        if (!_file) return;
        _charset = (_charset||'utf-8').toLowerCase();
        _content = _charset=='utf-8' ? _content
                 : _iconv.encode(_content+'\r\n',_charset);
        fs.writeFileSync(_file,_content);
};
// parse config file
var _path = __getArgs().path,
    _output = __getArgs().output||'core.js.txt';
// main program
function parser(){
    //script
    var _reg = /<script[\w\W]*?src\s*=\s*["'](.*?)["']/i,
        _list = __doReadFile(_path,'utf-8'),
        _line,
        _outList=[];
    for(var i=0;i<_list.length;i++){
        _line = _list[i];
        if (_reg.test(_line)){
                _line = RegExp.$1.split('?');
                _outList.push(_line[0].replace('${cfg_nej_dir}','http://192.168.146.85/nej/baseline/src'));
                continue;
            }
    }
    __doWriteFile(_output,JSON.stringify(_outList),'utf-8');
}
parser();