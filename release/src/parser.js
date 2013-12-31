var _fs     = require('./file.js'),
    _log    = require('./logger.js'),
    _util   = require('./util.js'),
    _path   = require('./path.js'),
    _config = require('./config.js'),
    _uglfjs = require('../../uglifyjs/uglify.js'),
     fs     = require('fs'),
     util   = require('util'),
     path   = require('path'),
     query  = require('querystring');
/*
 * 根据配置的字典信息合并数据
 * @param  {String} _text 合并前数据
 * @return {String}       合并后数据
 */
var _doMerge = function(_text){
    var _reg = _config.get('ALIAS_REG'),
        _map = _config.get('ALIAS_DICTIONARY');
    // ${abc} -> x/y/z or {xyz}
    return (_text||'').replace(_reg,
           function($1,$2){
               var _value = _map[($2||'').trim()];
               return _value==null?$1:_value;
           });
};
/*
 * 相对地址转绝对地址
 * @param  {String} _src  相对地址
 * @param  {String} _root 相对根路径
 * @return {String}       绝对路径
 */
var _doAbsolutePath = function(_src,_root){
    _src = _doMerge(_src);
    // for {A}a/b/c
    if (_src.indexOf('{')>=0)
        return _src;
    // for /a/b/c
    if (_src.indexOf('/')==0)
        _root = _config.get('DIR_WEBROOT');
    return _path.url(_src,_root);
};
/*
 * 计算静态资源相对路径
 * @param  {String} _type 静态资源类型
 * @param  {String} _root 相对根路径
 * @param  {String} _file 文件路径
 * @return {String}       相对路径
 */
var _doRelativePath = function(_type,_root,_file){
    _type = (_type||'').substr(0,2).toUpperCase();
    var _uline = !_type?'':'_';
    // use absolute path
    if (!_config.get('DM_STATIC_'+_type+_uline+'RR'))
        return _file.replace(_config.get('DIR_WEBROOT'),
                             _config.get('DM_STATIC'+_uline+_type));
    // use relative path
    var _name = _path.slash(path.relative(
                 path.dirname(_root),_file))||'';
    if (_name.indexOf('.')!=0)
        _name = './'+_name;
    return _name;
};
/**
 * 计算文件输出路径
 * @param  {String} _file 输入文件路径
 * @return {String}       输出文件路径
 */
var _doOutputPath = (function(){
    var _input = ['DIR_SOURCE','DIR_SOURCE_TP'],
        _otput = ['DIR_OUTPUT','DIR_OUTPUT_TP'];
    return function(_file){
        for(var i=0,l=_input.length,_value;i<l;i++){
            _value = _config.get(_input[i]);
            if (!!_value)
                _file = _file.replace(_value,
                        _config.get(_otput[i]));
        }
        return _file;
    };
})();
/*
 * 根据内容计算版本信息
 * @param  {String} _content 内容
 * @return {String}          版本
 */
var _doVersionFile = (function(){
    var _seed = +new Date;
    return function(_content){
        _content = _config.get('RAND_VERSION')
                 ? (''+(_seed++)) : _content;
        return _util.md5(_content);
    };
})();
/*
 * 资源文件带上版本信息
 * @param  {String} _file 原始文件地址
 * @return {String}       带版本信息地址
 */
var _doVersionResource = function(_file){
    // ignore if
    // - no STATIC_VERSION config
    // - resource has version in path
    // - resource is not exist
    // - resource is dir
    if (!_config.get('STATIC_VERSION')||
         _file.indexOf('?')>=0||
        !_path.exist(_file)||
         _fs.isdir(_file))
        return _file;
    return _file+'?'+_doVersionFile(_fs.content(_file));
};
/*
 * 遍历结果集文件
 * @param  {Object}   _result   结果集
 * @param  {Function} _callback 回调函数
 * @return {Void}
 */
var _doEachResult = (function(){
    var _prefix = ['pg_','tp_'];
    return function(_result,_callback){
        for(var x in _result){
            for(var i=0,l=_prefix.length;i<l;i++){
                _callback(_result[x],_prefix[i],x);
            }
        }
    };
})();
/*
 * 解析HTML文件
 * @param  {String} _file 文件路径
 * @param  {Object} _conf 配置信息
 * @return {Object}       文件信息
 */
var __doParseHtml = (function(){
        // tag line
        // ignore ie conditional comment
    var _reg0  = /^\s*<!--\s*(.+?)\s*-->\s*$/,
        _reg00 = /<!\s*\[/,    // for <![endif]--> or <!-- <![endif]-->
        _reg01 = /<!--\s*\[/,  // for <!--[if lte IE 7]> or <!--[if !IE]> -->
        // stylesheet
        _reg10 = /<link[\w\W]*?rel\s*=\s*["']stylesheet["']/i,
        _reg11 = /<link[\w\W]*?href\s*=\s*["'](.*?)["']/i,
        _reg12 = /<style\b/i,
        _reg13 = /<\/style>/i,
        // script
        _reg20 = /<script[\w\W]*?src\s*=\s*["'](.*?)["']/i,
        _reg21 = /^\s*<script\b/i,
        _reg22 = /<\/script>\s*$/i,
        // template
        _reg30 = /<textarea.*?name\s*=\s*["'](js|css|html)["']/i,
        _reg31 = /<\/textarea>/i;
    // check has core 
    var _hasCore = function(_txg,_name){
    	return !_txg.end&&_txg.name==_name&&
    	      !!_txg.param&&!!_txg.param.core;
    };
    // check core file inline flag
    var _isInline = function(_txg,_name){
    	return !_txg.end&&_txg.name==_name&&
    	      !!_txg.param&&!!_txg.param.inline;
    };
    return function(_file,_conf){
        _root = path.dirname(_file)+'/';
        _log.info('parse %s',_file);
        var _list = _fs.read(_file,
            _config.get('FILE_CHARSET')),
            _wrot = _config.get('DIR_SOURCE'),
            _rmode = _config.get('X_RELEASE_MODE');
        if (!_list||!_list.length){
            _log.warn('empty file %s',_file);
            return null;
        }
        // pg_js   [Array]  - js in html
        // pg_css  [Array]  - css in html
        // tp_js   [Array]  - js in template
        // tp_css  [Array]  - css in template
        // tp_mdl  [Array]  - embed module in template
        // tp_html [Array]  - embed html in template
        // source  [String] - html code after parse
        var _result = {},  // parse result
            _tag    = {},  // tag info  {name:'',param:{},brr:[],type:'',arr:[]}
            _source = [];  // html code list
        if (_config.get('X_NOCOMPRESS')) _tag.brr = [];
        for(var i=0,l=_list.length,_line,_tmp,_txg,_rot;i<l;i++){
            _line = _list[i];
            // tag line
            if (_reg0.test(_line)&&
               !_reg00.test(_line)&&
               !_reg01.test(_line)){
                _txg = __doParseHtmlTAG(
                         RegExp.$1,_tag,_source);
                // save tag param
                // <!-- @STYLE {core:true,inline:true} -->
                // <!-- @DEFINE {core:true,inline:true} -->
                if (_hasCore(_txg,'STYLE'))
                    _result.css = !0;
                if (_isInline(_txg,'STYLE'))
                    _result.icss = !0;
                if (_hasCore(_txg,'DEFINE'))
                    _result.js = !0;
                if (_isInline(_txg,'DEFINE'))
                    _result.ijs = !0;
                continue;
            }
            // ignore test content
            var _param = _tag.param||{},
                _mode = _param.mode||'online';
            if (_tag.name=='IGNORE'&&
                _mode.indexOf(_rmode)>=0){
                continue;
            }
            // do nothing
            if (_tag.name=='NOPARSE'){
                (_tag.brr||_source).push(_line);
                continue;
            }
            // external style
            if (_reg10.test(_line)&&
                _reg11.test(_line)){
                __doParseHtmlERS(_result,'pg_css',
                _doAbsolutePath(RegExp.$1.split('?')[0],_root));
                continue;
            }
            // inline style start tag <style type="text/css">
            if (_reg12.test(_line)){
                _tag.type = 'pg_css';
                __doParseHtmlIRSStart(_tag,_result);
            }
            // inline style end tag </style>
            if (_reg13.test(_line)){
                if (_tag.type!='pg_css'){
                    _log.warn('error inline style end tag!');
                }else{
                    __doParseHtmlIRSEnd(_tag,_result,_line,_tag.brr||_source);
                }
                continue;
            }
            // external script
            if (_reg20.test(_line)){
                _line = RegExp.$1.split('?');
                _line[0] = _doAbsolutePath(_line[0],_root);
                if (_tag.name=='DEFINE'){
                    delete _tag.name;
                    var _param = _tag.param||{};
                    delete _tag.param;
                    if (!_param.nodep){
                        __doParseHtmlDefine(
    					 _line.join('?'),_conf,_root);
                        continue;
                    }
                }
                __doParseHtmlERS(_result,'pg_js',_line[0]);
                continue;
            }
            // inline script start tag <script type="text/javascript">
            if (_reg21.test(_line)){
                _tag.type = 'pg_js';
                __doParseHtmlIRSStart(_tag,_result);
            }
            // inline script end tag </script>
            if (_reg22.test(_line)){
                if (_tag.type!='pg_js'){
                    _log.warn('error inline script end tag!');
                }else{
                    _tag.name=='VERSION'
                    ? __doParseHtmlVersion(_tag)
                    : __doParseHtmlIRSEnd(_tag,_result,_line,_tag.brr||_source);
                }
                continue;
            }
            // template
            if (_tag.name=='MODULE'||
                _tag.name=='TEMPLATE'){
                // resource template start tag <textarea name="js|css|html" ...
                if (_reg30.test(_line)){
                    _tag.type = RegExp.$1;
                    if (!_tag.arr)
                        _tag.arr  = [];
                }
                // resource template end tag </textarea>
                if (!!_tag.type
                    &&_reg31.test(_line)){
                    _tag.arr.push(_line.trim());
                    if (_tag.name=='MODULE'&&_tag.type=='html')
                        _tag.type = 'mdl';
                    // external template path must in DIR_SOURCE
                    _rot = _root;
                    if (_rot.indexOf(_wrot)<0){
                        _rot = _wrot;
                    }
                    __doParseHtmlTemplate(_tag,_result,_rot);
                    continue;
                }
            }
            // style/script/template content
            if (!!_tag.type){
                _tag.arr.push(_line.trim());
                continue;
            }
            // save line
            if (!!_tag.brr){
                _tag.brr.push(_line);
            }else if(!_util.blank(_line)){
                _source.push(_line.trim());
            }
        }
        if (!!_tag.brr)
            _source.push(_tag.brr.join('\n'));
        _result.source = _source.join(' ');
        __doParseHtmlModule(_result);
        return _result;
    };
})();
/*
 * 解析标记行
 * @param  {String} _line   标记内容
 * @param  {Object} _last   上一个标记信息
 * @param  {Array}  _result 解析结果
 * @return {Object}         标记信息
 */
var __doParseHtmlTAG = (function(){
    var _tag2obj = function(_tag){
        var _result = {};
        if (_tag.indexOf('/')==0)
            _result.end = !0;
        var _beg = _tag.indexOf('@')+1,
            _end = _tag.search(/\s|{|$/);
        _result.name = _tag.substring(_beg,_end).toUpperCase();
        var _code = _tag.substring(_end,_tag.length).trim();
        _result.param = !_code?null:_util.eval(util.format('(%s)',_code));
        return _result;
    };
    return function(_line,_last,_result){
        // comment line
        if (_line.indexOf('@')<0){
        	_log.info('ignore comment line: %s',_line);
        	return {};
        }
        // tag line
        var _tag  = _tag2obj(_line);
        !_tag.end ? __doParseHtmlTAGStart(_tag,_last,_result)
                  : __doParseHtmlTAGEnd(_tag,_last,_result);
        return _tag;
    };
})();
/*
 * 解析起始标记
 * @param  {Object} _tag    当前标记信息
 * @param  {Object} _last   上一个标记信息
 * @param  {Array}  _result 结果收集队列
 * @return {Void}
 */
var __doParseHtmlTAGStart = function(_tag,_last,_result){
    var _list = _last.brr||_result;
    switch(_tag.name){
        case 'NOCOMPRESS':
            if (_config.get('X_NOCOMPRESS')) return;
            if (!!_last.brr){
                _log.warn('duplicated start tag[NOCOMPRESS],ignore start tag!');
            }else if(!!_last.name&&_last.name!='TEMPLATE'){
                _log.warn('error nested start tag[NOCOMPRESS],ignore start tag!');
            }else{
                _last.brr = [];
            }
        break;
        case 'STYLE':
            _list.push('#<PG_CSS>');
        break;
        case 'TEMPLATE':
        case 'VERSION':
        case 'NOPARSE':
        case 'MODULE':
        case 'DEFINE':
        case 'IGNORE':
            if (!!_last.name){
                _log.warn('start tag[%s] before end tag[%s],ignore start tag!',_tag.name,_last.name);
            }else{
                _last.name = _tag.name;
                _last.param = _tag.param;
                if (_tag.name=='DEFINE'){
                	_list.push('#<PG_JS>');
                }
                if (_tag.name=='VERSION')
                    _list.push('#<VERSION>');
            }
        break;
        default:
            _log.warn('error named start tag[%s],igonre start tag!',_tag.name);
        break;
    }
};
/*
 * 解析结束标记
 * @param  {Object} _tag    当前标记信息
 * @param  {Object} _last   上一个标记信息
 * @param  {Array}  _result 结果收集队列
 * @return {Void}
 */
var __doParseHtmlTAGEnd = function(_tag,_last,_result){
    var _list = _last.brr||_result;
    switch(_tag.name){
        case 'NOCOMPRESS':
            if (_config.get('X_NOCOMPRESS')) return;
            if (!_last.brr){
                _log.warn('no start tag[NOCOMPRESS],ignore end tag!');
            }else{
                _result.push(_last.brr.join('\n'));
                delete _last.brr;
            }
        break;
        case 'TEMPLATE':
            if (_last.name!='TEMPLATE'){
                _log.warn('error nested end tag[TEMPLATE],ignore end tag!');
            }else{
                _list.push('#<TP_HTML>#<TP_CSS>#<TP_JS>');
                delete _last.name;
                delete _last.param;
            }
        break;
        case 'MODULE':
            if (_last.name!='MODULE'){
                _log.warn('error nested end tag[MODULE],ignore end tag!');
            }else{
                _list.push('<!--TP_HTML-->');
                delete _last.name;
                delete _last.param;
            }
        break;
        case 'NOPARSE':
        case 'IGNORE':
            if (_last.name!=_tag.name){
                _log.warn('error nested end tag['+_tag.name+'],ignore end tag!');
            }
            delete _last.name;
            delete _last.param;
        break;
        default:
            _log.warn('error named end tag[%s],igonre end tag!',_tag.name);
        break;
    }
};
/*
 * 解析外链资源
 * @param  {Object} _result 结果集
 * @param  {String} _type   类型
 * @param  {String} _src    外链地址
 * @return {Void}
 */
var __doParseHtmlERS = function(_result,_type,_src){
    var _arr = _result[_type];
    if (!_arr){
        _arr = [];
        _result[_type] = _arr;
    }
    _arr.push(_src);
};
/*
 * 解析内联资源起始标签
 * @param  {Object} _tag    标签信息
 * @param  {Object} _result 解析结果
 * @return {Void}
 */
var __doParseHtmlIRSStart = function(_tag,_result){
    if (!_tag.arr)
        _tag.arr = [];
    if (!_result[_tag.type])
        _result[_tag.type] = [];
};
/*
 * 解析内联资源结束标签
 * @param  {Object} _tag    标签信息
 * @param  {Object} _result 解析结果
 * @param  {String} _line   最后一行信息
 * @param  {Array}  _cache  源码缓存
 * @return {Void}
 */
var __doParseHtmlIRSEnd = (function(){
    var _reg = /<\/?(style|script)[\w\W]*?>/gi;
    var _isIgnore = function(_type){
        var _nopsfg = _config.get('X_NOPARSE_FLAG');
        return ((_nopsfg==1||_nopsfg==3)&&_type.indexOf('cs')>0)||
               ((_nopsfg==2||_nopsfg==3)&&_type.indexOf('js')>0);
    };
    return function(_tag,_result,_line,_cache){
        _tag.arr.push(_line.trim());
        var _source = _tag.arr.join('\n');
        if (_isIgnore(_tag.type)){
            _cache.push(_source);
        }else{
            _source = _source.replace(_reg,'').trim();
            if (!!_source)
                _result[_tag.type].push(_source);
        }
        delete _tag.arr;
        delete _tag.type;
    };
})();
/*
 * 解析模块版本信息标记脚本
 * @param  {Object} _tag 标记信息
 * @return {Void}
 */
var __doParseHtmlVersion = function(_tag){
    delete _tag.arr;
    delete _tag.type;
    delete _tag.name;
    delete _tag.param;
};
/*
 * 解析依赖库文件地址
 * @param  {String} _url  库文件地址
 * @param  {Object} _conf 配置信息
 * @param  {String} _root 当前文件所在目录
 * @return {Void}
 */
var __doParseHtmlDefine = (function(){
    var _pmap = {win:'trident-1'},
        _bmap = {td:['trident-0','trident-1','trident'],
                'td-0':['trident-1','trident'],
                'td-1':'trident-1',gk:'gecko',wk:'webkit',pt:'presto'},
        _reg9 = /(cef|ios|win|android)/;
    var _platform = function(_config){
        var _root = {};
        if (!_config)
            _config = 'td|gk|wk|pt';
        // hybrid development
        if (_reg9.test(_config)){
            var _name = RegExp.$1;
            _root['native'] = '{lib}native/'+_name+'/';
            _root['patch']  = '{lib}patched/'+(_pmap[_name]||'webkit')+'/';
            return _root;
        }
        // browser development
        _root.patch = [];
        var _arr = _config.split('|');
        for(var i=0,l=_arr.length,_name;i<l;i++){
            _name = _bmap[_arr[i]];
            if (!_name) continue;
            if (util.isArray(_name))
                for(var j=0,k=_name.length;j<k;j++)
                    _root.patch.push('{lib}patched/'+_name[j]+'/');
            else
                _root.patch.push('{lib}patched/'+_name+'/');
        }
        return _root;
    };
    return function(_url,_conf,_root){
        var _arr   = _url.split('?'),
            _query = query.parse(_doMerge(_arr[1])||''),
            _roots = _platform(_query.p);
        delete _query.p;
        delete _query.c;
        var _cfrot = _conf.root||{};
        // pro/com/...
        for(var x in _query)
            _cfrot[x] = _doAbsolutePath(_query[x],_root);
        if (!_cfrot.pro)
            _cfrot.pro = _doAbsolutePath('../javascript/',_root);
        // patch/native
        for(var x in _roots)
            _cfrot[x] = _roots[x];
        // lib
        _cfrot.lib = _config.get('NEJ_DIR')||
                     (path.dirname(_arr[0])+'/');
        _conf.root = _cfrot;
    };
})();
/*
 * 解析资源模板信息
 * @param  {Object} _tag    标记信息
 * @param  {Object} _result 结果收集对象
 * @param  {String} _root   文件所在目录
 * @return {Void}
 */
var __doParseHtmlTemplate = (function(){
    var _reg0 = /<textarea[\w\W]*?data-src\s*=\s*["'](.*?)["']/i,
        _reg1 = /^\s*<textarea[\w\W]*?>/i,
        _reg2 = /<\/textarea>\s*$/i;
    return function(_tag,_result,_root){
        var _src,_code,
            _content = _tag.arr.join('\n');
        if (_reg0.test(_content))
            _src = RegExp.$1;
        _code = _content.replace(_reg1,'')
                        .replace(_reg2,'').trim();
        var _list = _result['tp_'+_tag.type];
        if (!_list){
            _list = [];
            _result['tp_'+_tag.type] = _list;
        }
        if (!!_src){
            _src = _src.split(',');
            for(var i=0,l=_src.length,_url;i<l;i++){
                _url = _doAbsolutePath(_src[i],_root);
                _path.exist(_url)
                ? _list.push(_url)
                : _log.warn('external template not exist -> %s',_url);
            }
        }
        if (!!_code) _list.push(_code);
        delete _tag.arr;
        delete _tag.type;
    };
})();
/*
 * 解析页面中使用的模块资源
 * @param  {Object} _result 解析结果
 * @return {Void}
 */
var __doParseHtmlModule = function(_result){
    // check tp_mdl and revert to template 
    var _xlist = _result.tp_mdl,
        _xcode = _result.source;
    if (!_xlist||!_xlist.length) return;
    // check define flag
    var _wrap = _config.get('X_MODULE_WRAPPER');
	if (_xcode.indexOf('#<PG_JS>')>=0){
	    var _module = util.format(_wrap,'#<TP_MDL>');
		_result.source = _xcode.replace('<!--TP_HTML-->','')
		                       .replace('#<PG_JS>',_module+'#<PG_JS>');
	}else{
		// revert to template 
    	var _list = _result.tp_html||[];
    	_list.push.apply(_list,_xlist);
    	_result.tp_html = _list;
    	delete _result.tp_mdl;
    	_result.source = _xcode.replace(
    	    '<!--TP_HTML-->',util.format(_wrap,'#<TP_HTML>')
    	);
	}
};
/*
 * 解析页面中使用的静态资源的路径
 * @param  {Object} _result 解析结果
 * @return {Void}
 */
var __doParseHtmlResource = (function(){
    var _isRelative = function(_url){
        return _url.indexOf('.')==0||
              (_url.indexOf(':')<0&&
               _url.indexOf('/')!=0);
    };
    var _doTryFix = function(_url,_split){
        if (!_isRelative(_url)) return;
        var _uri,_cout = 1,_test = '',
            _otpt = _config.get('DIR_SOURCE');
        while(_cout<10){
            _uri = _doAbsolutePath(_url,_otpt+_test);
            if (_path.exist(_uri)){
                return util.format('%s#<%s:%s>%s',
                      _split,_cout,_uri,_split);
            }
            _cout++;
            _test += 'xx/';
        }
    };
    var _doComplete = function(_content,_file){
        var _tmpl = '%s#<:%s>%s',
            _base = path.dirname(_file)+'/';
        return (_content||'').replace(
                _config.get('DIR_STATIC_REG'),
                function($1,$2,$3){
                    var _url = _doAbsolutePath($3,_base);
                    if (_path.exist(_url))
                        return util.format(_tmpl,$2,_url,$2);
                    // try to fix path
                    return _doTryFix($3,$2)||$1;
                });
    };
    return function(_result){
        var _fobj,
            _files = _result.files;
        for(var x in _files){
            _fobj = _files[x];
            _fobj.source = _doComplete(_fobj.source,x);
        }
    };
})();
/**
 * 分析需要解析的文件列表
 * @param  {String} _dir    目录
 * @param  {Object} _result 结果集
 * @return {Void}
 */
var __doListHtmlFile = function(_dir,_result){
    try{
        if (!_dir) return;
        var _list = fs.readdirSync(_dir);
        if (!_list&&!_list.length){
            _log.warn('no file to parse! %s',_dir);
        }else{
            if (!_result.conf) _result.conf = {root:{}};
            if (!_result.files) _result.files = {};
            if (!_result.manifest) _result.manifest = {};
            for(var i=0,l=_list.length,_file,_data,
                _reg = _config.get('FILE_SUFFIXE'),
                _reg1 = _config.get('FILE_FILTER');i<l;i++){
                _file = _list[i];
                if (_util.svn(_file))
                    continue;
                _file = _dir+_file;
                if (_fs.isdir(_file)){
                    __doListHtmlFile(_file+'/',_result);
                    continue;
                }
                if ((!!_reg&&!_reg.test(_file))||
                    (!!_reg1&&!_reg1.test(_file)))
                    continue;
                _data = __doParseHtml(_file,_result.conf);
                if (!!_data){
                    _result.files[_file] = _data;
                    _log.debug('%s -> %j',_file,_data.pg_js||_data.tp_js);
                } 
            }
        }
    }catch(e){
        _log.error('can\'t list files \n %s',e.stack);
    }
};
/*
 * 解析脚本列表
 * @param  {Array}  _list   脚本列表
 * @param  {Object} _result 结果集
 * @return {Void}
 */
var __doParseJSList = function(_list,_result){
    if (!_result.deps) _result.deps = {};
    if (!_result.data) _result.data = {};
    if (!_list||!_list.length) return;
    __doParseJSPatched(_list,_result.conf.root);
    for(var i=0,l=_list.length,_file;i<l;i++){
        _file = _list[i];
        if (!!_result.data[_file])
            continue;
        if (_path.remote(_file)){
            __doDownloadExternalJS(_file,_result);
            continue;
        }
        if (!_path.exist(_file)){
            // see as code
            _log.warn('js file not exist -> %s',_file);
            _list[i] = 'js-code-'+(_result.rmap.seed++);
            __doParseJSContent(_list[i],
             _file.split('\n'),_result);
            continue;
        }
        __doParseJSFile(_file,_file,_result);
    }
};
/*
 * 解析脚本文件
 * @param  {String} _alias  文件别名
 * @param  {String} _file   文件路径
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doParseJSFile = function(_alias,_file,_result){
    if (!!_result.data[_alias]) 
        return;
    _log.info('parse %s',_alias);
    var _charset = _config.get('FILE_CHARSET');
    if (_alias.indexOf(
        _result.conf.root.lib)>=0) 
        _charset = 'utf-8';
    var _list = _fs.read(_file,_charset);
    if (!_list||!_list.length){
        _log.warn('empty file!');
        return;
    }
    __doParseJSContent(_alias,_list,_result);
};
/*
 * 解析脚本内容
 * @param  {String} _alias  文件别名
 * @param  {Array}  _list   文件内容
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doParseJSContent = (function(){
    var f,
        _reg1 = /^\s*(NEJ\.)?define\(/,
        _reg2 = /;$/i;
    var _doDefine = function(_uri,_deps,_callback){
        // define('',[],f);
        // define('',f);
        // define([],f);
        // define(f);
        if (_util.func(_deps)){
            _callback = _deps;
            _deps = null;
        }
        if (util.isArray(_uri)){
            _deps = _uri;
            _uri = '';
        }
        if (_util.func(_uri)){
            _callback = _uri;
            _deps = null;
            _uri = '';
        }
        return {
            deps:_deps,
            code:util.format('(%s)();',(_callback||'').toString())
        };
    };
    return function(_alias,_list,_result){
        _list = _list||[];
        // parse js file content
        var _find = !1,
            _source = [];
        for(var i=0,l=_list.length,_line;i<l;i++){
            _line = (_list[i]||'').trim();
            if (_util.blank(_line)) continue;
            // define statement   define('',[],f)
            if (_reg1.test(_line)){
                if (_find)
                    _log.warn('duplicated define in %s',_alias);
                _find = !0;
            }
            _source.push(_line);
        }
        var _map = {code:_source.join('\n')};
        if (_find){
            try{
                var define = _doDefine,
                    NEJ = {define:_doDefine},
                    _umap = eval(_map.code);
                _map = _umap||_map;
            }catch(e){
                // ignore if define is 3rd lib api
                _log.debug(e);
                _log.warn('3rd lib with define -> %s',_alias);
            }
        }
        _result.data[_alias] = _map.code||'';
        _result.deps[_alias] = _map.deps||[];
        _log.debug('dependency result: %s -> %j',_alias,_map.deps);
        __doParseJSList(_result.deps[_alias],_result);
    };
})();
/*
 * 解析脚本补丁信息
 * @param  {Array}  _list 脚本列表
 * @param  {Object} _conf 路径配置信息
 * @return {Void}
 */
var __doParseJSPatched = (function(){
    var _reg = /{(.*?)}/gi,
	    _reg1 = /([^:])\/+/g;
    var _complete = function(_file,_conf){
        return _file.replace(_reg,function($1,$2){
            return _conf[$2]||$1;
        }).replace(_reg1,'$1/');
    };
    return function(_list,_conf){
        if (!_list||!_list.length) return;
        var _native  = _conf['native'],
            _patched = _conf['patch'],
            _istring = !util.isArray(_patched);
        for(var i=_list.length-1,_name;i>=0;i--){
            _name = _list[i];
            if (!!_native&&_name.indexOf('{native}')>=0)
                _list[i] = _name.replace('{native}',_native);
            if (_name.indexOf('{patch}')>=0){
                if (_istring)
                    _list[i] = _name.replace('{patch}',_patched);
                else{
                    _name = _name.replace('{patch}','');
                    _name = (_patched.join(_name+',')+_name).split(',');
                    _name.unshift(i,1);
                    _list.splice.apply(_list,_name);
                }
            }
        }
        for(var i=0,l=_list.length;i<l;i++)
            _list[i] = _complete(_list[i],_conf);
    };
})();
/*
 * 解析脚本依赖关系
 * @param  {Array}  _list   脚本列表
 * @param  {Object} _result 结果集
 * @return {Array}          整合了依赖关系的脚本列表
 */
var __doParseJSDependency = (function(){
    var _dependency = function(_list,_dmap,_test){
        if (!_list||!_list.length) 
            return null;
        var _result = [];
        for(var i=0,l=_list.length,_file,_files;i<l;i++){
            _file = _list[i];
            if (!!_test[_file])
                continue;
            _test[_file] = !0;
            _files = _dependency(_dmap[_file],_dmap,_test);
            if (!!_files&&_files.length>0)
                _result.push.apply(_result,_files);
            _result.push(_file);
        }
        return _result;
    };
    return function(_list,_result){
        return _dependency(_list,_result.deps,{});
    };
})();
/*
 * 解析样式文件
 * @param  {String} _file   文件路径
 * @param  {Object} _result 结果集
 * @return {Void}
 */
var __doParseCSFile = function(_file,_result){
    if (!!_result.data[_file]) 
        return _file;
    var _list,
        _return = _file,
        _rmap = _result.rmap;
    if (!_rmap[_file]&&
        !_path.exist(_file)){
        _log.warn('css file not exist -> %s',_file);
        _return = 'cs-code-'+(_rmap.seed++);
        _list = _file.split('\n');
    }else{
        _file = _rmap[_file]||_file;
        _list = _fs.read(_file,_config.get('FILE_CHARSET'));
    }
    __doParseCSContent(_return,_list,_result);
    return _return;
};
/*
 * 解析样式文件内容
 * @param  {String} _file   文件名
 * @param  {Array}  _list   内容列表
 * @param  {Object} _result 结果集
 * @return {Void}
 */
var __doParseCSContent = (function(){
    var _reg0 = /\/\*[\w\W]*?\*\//gi,
        _reg1 = /url\((.*?)\)/gi,
        _reg2 = /(?:^['"]+)|(?:['"]+$)/gi;
    return function(_file,_list,_result){
        var _content;
        _list = _list||[];
        for(var i=0,l=_list.length;i<l;i++)
            _list[i] = _list[i].trim();
        // parse resources in css
        _content = _list.join('').replace(_reg0,'');
        var _base = _file.indexOf('cs-code-')==0
                  ? _config.get('DIR_SOURCE')
                  : path.dirname(_file)+'/';
        _content = _content.replace(_reg1,function($1,$2){
            return util.format('url(%s)',
                  _doAbsolutePath($2.replace(_reg2,''),_base));
        });
        _result.data[_file] = _content;
    };
})();
/*
 * 解析样式文件中引入的资源
 * @param  {String}  _file    样式输出文件
 * @param  {String}  _content 样式文件内容
 * @param  {Boolean} _inline  是否内联样式
 * @return {String}           解析后文件内容
 */
var __doParseCSResource = (function(){
    var _reg = /url\((.*?)\)/gi;
    var _exroot = function(_output,_file){
        return _path.slash(path.relative(path.dirname(_output)+'/',_file));
    };
    var _inroot = function(_output,_file){
        return _file.replace(_config.get('DIR_WEBROOT'),_output);
    };
    return function(_file,_content,_inline){
        var _base = _file,
            _process = _exroot,
            _root = _config.get('DIR_WEBROOT');
        if (!!_inline){
            if (_config.get('DM_STATIC_RR')){
                _base = _config.get('DIR_OUTPUT')+'xx';
            }else{
                _base = _config.get('DM_STATIC');
                _process = _inroot;
            }
        }
        _content = (_content||'').replace(_reg,function($1,$2){
            if (!_path.exist($2)){
                _log.warn('%s in %s not exist!',$2,_file);
                return $1;
            }
            if ($2.indexOf(_root)<0)
                _log.warn('%s in %s not in webroot!',$2,_file);
            return util.format('url(%s)',
                  _process(_base,_doVersionResource($2)));
        });
        return _content;
    };
})();
/*
 * 检测文件下载情况
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doDownloadCheck = function(_result){
    var _map = _result.rmap,
        _finished = !0;
    for(var x in _map){
        if (_map[x]===!0){
            _finished = !1;
            break;
        }
    }
    if (_finished)
        _result.ondownload();
};
/*
 * 下载样式文件
 * @param  {Array}  _list   样式文件列表
 * @param  {Object} _result 结果集
 * @return {Void}
 */
var __doDownloadExternalCS = function(_list,_result){
    if (!_list||!_list.length) return;
    var _map = _result.rmap,
        _tmp = _config.get('DIR_TEMPORARY');
    for(var i=0,l=_list.length,_file;i<l;i++){
        _file = _list[i];
        if (_path.remote(_file)&&!_map[_file]){
            _map[_file] = !0;
            _fs.download(_file,util
               .format('%s%s.css',_tmp,++_map.seed)
               ,function(_file,_local,_content){
                       _map[_file] = _local;
                       __doDownloadCheck(_result);
               });
        }
    }
};
/*
 * 下载脚本文件
 * @param  {String} _file   脚本文件
 * @param  {Object} _result 结果集
 * @return {Void}
 */
var __doDownloadExternalJS = function(_file,_result){
    var _map = _result.rmap,
        _tmp = _config.get('DIR_TEMPORARY');
    if (!!_map[_file]) return;
    _map[_file] = !0;
    var _xloc = util.format('%s%s.js',_tmp,++_map.seed);
    _log.debug('map %s -> %s.js',_file,_map.seed);
    _fs.download(_file,_xloc,
       function(_file,_local,_content){
             // error if file has been downloaded
             if (!!_map[_file]&&_map[_file]!=!0){
                 _log.error('download conflict %s : %s,%s',_file,_map[_file],_local);
             }
             _map[_file] = _local;
            //__doParseJSFile(_file,_local,_result);
            __doParseJSContent(_file,_content.split('\n'),_result);
            __doDownloadCheck(_result);
       });
};
/**
 * 下载外联资源
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doDownloadResource = function(_result){
    if (!_result.rmap)
         _result.rmap = {seed:+new Date};
    __doPrepareCore(_result);
    _doEachResult(_result.files,function(_fobj,_prefix){
        // download css
        __doDownloadExternalCS(_fobj[_prefix+'css'],_result);
        // parse and download javascript
        __doParseJSList(_fobj[_prefix+'js'],_result);
    });
    __doDownloadExternalCS(_result.core.cs,_result);
    __doParseJSList(_result.core.js,_result);
	__doDownloadCheck(_result);
};
/*
 * 准备缓存结构
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doPrepareCache = (function(){
    var _list = ['js','cs'];
    return function(_result){
        if (!!_result.output) return;
        var _core = _result.core;
        _core.js = __doParseJSDependency(_core.js,_result);
        
        _result.output = {js:{core:_core.js||[]}
                         ,css:{core:_core.cs||[]}
                         ,core:{}};
        // build core js/css maps
        var _cmap = _result.output.core;
        for(var i=0,l=_list.length,_files;i<l;i++){
            _files = _core[_list[i]];
            if (!_files||!_files.length) continue;
            for(var j=0,k=_files.length;j<k;j++){
                _cmap[_files[j]] = !0;
            }
        }
        delete _result.core;
    };
})();
/*
 * 准备配置的core文件列表
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doPrepareCore = (function(){
    var _list = ['js','cs'],
        _xmxp = {cs:'STYLE',js:'SCRIPT'};
    var _complete = function(_list,_root){
        if (!_list||!_list.length) return;
        for(var i=0,l=_list.length;i<l;i++){
            // start with {lib} or prefix variable
            if (_list[i].indexOf('{')==0) continue;
            _list[i] = _doAbsolutePath(_list[i],_root);
        }
    };
    return function(_result){
        var _core = _result.core;
        if (!_core){
            _core = {};
            _result.core = _core;
        }
        for(var i=0,l=_list.length,_file,_cont,_ign;i<l;i++){
            // check ignore core config
            _ign = _config.get('X_NOCORE_'+_xmxp[_list[i]]); 
            if (_ign) continue;
            // core config in release.conf
            _file = _config.get('CORE_LIST_'
                  + _list[i].toUpperCase());
            if (!_file) continue;
            if (util.isArray(_file)){
                _core[_list[i]] = _file;
                continue;
            }
            // core config from file
            _cont = _fs.read(_file);
            if (!_cont||!_cont.length) continue;
            _cont = _cont.join('').trim();
            if (!_cont) continue;
            _core[_list[i]] = _util.eval(util.format('(%s)',_cont));
        }
        var _root = _config.get('DIR_WEBROOT');
        _complete(_core.cs,_root);
        _complete(_core.js,_root);
    };
})();
/*
 * 准备列表
 * @param  {Object} _result 解析结果集
 * @param  {Object} _conf   配置信息
 *                          type - 类型 js/css
 *                          lfuc - 预处理列表
 *                          ffuc - 预处理文件
 * @return {Void}
 */
var __doPrepareList = (function(){
    var _xmxp = {css:'STYLE',js:'SCRIPT'};
    var f = function(){
        return !1;
    };
    return function(_result,_conf){
        __doPrepareCache(_result);
        var _type = _conf.type,
            _xmap = {},
            _xlst = _result.output[_type].core,
            _fmap = _result.output.core,
            _iscf = _xlst.length>0||
                    _config.get('X_NOCORE_'+_xmxp[_type]);
        _doEachResult(_result.files,function(_fobj,_prefix){
            // pre-parse list
            var _list = _fobj[_prefix+_type];
            if (!_list||!_list.length) return;
            _list = (_conf.lfuc||f)(_list,_result)||_list;
            _fobj[_prefix+_type] = _list;
            for(var i=0,l=_list.length,_file;i<l;i++){
                // pre-parse file
                _file = _list[i];
                _file = (_conf.ffuc||f)(_file,_result)||_file;
                _list[i] = _file;
                if (_iscf) continue;
                // calculate file count
                if (!_xmap[_file])
                    _xmap[_file] = 0;
                _xmap[_file]++;
                if (_xmap[_file]==2){
                    _xlst.push(_file);
                    _fmap[_file] = !0;
                }
            }
        });
        _log.info('core %s file list -> %j',_type,_xlst);
        var _output = _result.output[_type];
        _doEachResult(_result.files,function(_fobj,_prefix,_name){
            var _list = _fobj[_prefix+_type];
            if (!_list||!_list.length) return;
            for(var i=_list.length-1;i>=0;i--){
                if (!!_fmap[_list[i]]){
                    _fobj[_type] = !0;
                    _list.splice(i,1);
                }
            }
            _output[_prefix+_name] = _list;
            _log.info('%s for %s %s file list -> %j',
                      _prefix,_name,_type,_list);
        });
    };
})();
/**
 * 预处理样式文件
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doPrepareCS = function(_result){
    __doPrepareList(_result,{
        type:'css'
       ,ffuc:__doParseCSFile
    });
    var _list = [],_arr,
        _data = _result.data,
        _output = _result.output.css,
        _split = _config.get('OBF_LINE_MODE')==1?'\n':'';
    for(var x in _output){
        _arr = [];
        _list = _output[x];
        for(var i=0,l=_list.length,_source;i<l;i++){
            _source = (_data[_list[i]]||'').trim();
            if (!!_source) _arr.push(_source);
        }
        _output[x] = _arr.join(_split).trim();
    }
};
/**
 * 预处理脚本文件
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doPrepareJS = function(_result){
    __doPrepareList(_result,{
        type:'js'
       ,lfuc:__doParseJSDependency
    });
    var _options = {
        obf_level:_config.get('OBF_LEVEL')
       ,obf_line_mode:_config.get('OBF_LINE_MODE')
       ,code_map:_result.data
    };
    var _file = _config.get('OBF_NAME_BAGS'),
        _list = _fs.read(_file);
    if (!!_list&&!!_list.length){
        var _bags = _list.join('').trim();
        if (!!_bags)
            _options.bags = _util.eval(util.format('(%s)',_bags));
    }
	var _data = {bags:'',files:[]};
    try{
        _data = _uglfjs.generate_by_group_outcode(
                       _result.output.js,_options);
    }catch(e){
        _log.error('obfuscate js error %s',e);
    }
    _log.info('output %s',_file);
    _fs.write(_file,util.format('%j',_data.bags));
    _result.output.js = _data.files;
};
/*
 * 输出文件
 * @param  {String} _file    文件地址
 * @param  {String} _content 文件内容
 * @param  {String} _conf    配置信息
 *                           type - 类型 cs/js
 *                           mode - 模式 0/1[模板样式]
 *                           html - 文件所在页面文件路径，没有表示core文件
 * @return {String}          样式连接
 */
var __doExlineFile = (function(){
    var _reg = /url\((.*?)\)/gi,
        _tmap = {cs:['<link href="%s%s" type="text/css" rel="stylesheet"/>'
                    ,'<textarea name="css" data-src="#<cs:%s>" data-version="%s"></textarea>']
                ,js:['<script src="%s%s" type="text/javascript"></script>'
                    ,'<textarea name="js" data-src="#<js:%s>" data-version="%s"></textarea>']};
    return function(_file,_content,_conf){
        var _type = _conf.type;
        _log.info('output %s',_file);
        if (_type=='cs')
            _content = __doParseCSResource(_file,_content);
        _fs.write(_file,_content,_config.get('FILE_CHARSET'));
        var _root = '#<CORE>',_md5 = _doVersionFile(_content),
            _version = _config.get('NAME_SUFFIX')?'':((!_conf.mode?'?':'')+_md5);
        // not core file
        if (!!_conf.html)
            _root = _conf.mode==1?_file:_doRelativePath(
                    _type,_doOutputPath(_conf.html),_file);
        return {link:util.format(_tmap[_type][_conf.mode],_root,_version),version:_md5};
    };
})();
/*
 * 内联文件
 * @param  {String} _content 文件内容
 * @param  {String} _conf    配置信息
 *                           type - 类型 cs/js
 *                           mode - 模式 0/1[模板样式]
 * @return {String}          样式连接
 */
var __doInlineFile = (function(){
    var _regc = [/<\/(script)>/gi,/<\/(textarea)>/gi],
        _tmap = {
            cs:['<style type="text/css">%s</style>',
                '<textarea name="css">%s</textarea>'],
            js:['<script type="text/javascript">%s</script>',
                '<textarea name="js">%s</textarea>']
        };
    return function(_content,_conf){
        if (_conf.type=='js'){
            _content = _content.replace(_regc[_conf.mode],'<&#47;$1>');
        }
        return util.format(_tmap[_conf.type][_conf.mode],_content);
    };
})();
/*
 * 合并样式和脚本
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doMergeCSandJS = (function(){
    var _reg = /#<((?:tp|pg)_(?:css|js))>/gi;
    return function(_result){
        var _data  = _result.output,
            _files = _result.files,
            _core  = _config.get('DIR_OUTPUT_STATIC')+'core.',
            _fobj,_content,_value,_flag,_clink,_core;
        for(var x in _files){
            _fobj = _files[x];
            _content = _fobj.source;
            _files[x].source = _content
                     .replace(_reg,function($1,$2){
                     	  // 0 - tp/pg
                     	  // 1 - css/js
                          _flag = $2.toLowerCase().split('_');
                          switch(_flag[0]){
                              case 'pg':
                                  _value = '';
                                  _clink = _data[_flag[1]].core;
                                  // if has core file
                                  if (_fobj[_flag[1]]&&!!_clink){
                                  	  // check inline core
                                  	  if (_fobj['i'+_flag[1]]){
                                  	      _value = __doInlineFile(
	                                  	      	   __doParseCSResource(x,_data[_flag[1]+'_code'],!0),{
		                                  	           mode:0,
		                                  	           type:_flag[1].substr(0,2)
		                                  	       });
                                  	  }else{
	                                      _value = _clink.replace('#<CORE>',
	                                               _doRelativePath(_flag[1],
	                                               _doOutputPath(x),_core+_flag[1]));
                                  	  }
                                  }
                                  _value += _data[_flag[1]]['pg_'+x]||'';
                              break;
                              case 'tp':
                                  _value = _data[_flag[1]]['tp_'+x]||'';
                              break;
                          }
                          return _value;
                      });
        }
    };
})();
/*
 * 合并嵌套模板
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doMergeTemplate = (function(){
    var _reg1 = /#<(js|cs|[\d]*?):(.*?)>/gi,
        _reg2 = /<meta.*?>/i,
        _tmpl = '<div style="display:none;" id="umi://%s">%s</div>';
    var _doMergeHTML = function(_file,_data,_test){
        var _fobj = _data[_file];
        if (!_fobj) return '';
        var _list = _fobj.tp_html;
        if (!_list||!_list.length)
            _list = '';
        if (!util.isArray(_list)){
            // template has been embeded
            _fobj.tp_html = _list;
        }else{
            // embed template
            var _arr = [];
            for(var i=0,l=_list.length,_name,_result;i<l;i++){
                _name = _list[i];
                if (!!_test[_name]) 
                    continue;
                _test[_name] = !0;
                _result = _doMergeHTML(_name,_data,_test);
                _arr.push(_result.replace(_reg2,''));
            }
            _fobj.tp_html = _arr.join('');
        }
        // merge template
        // don't use replace
        var _source = _fobj.source
                .split('#<TP_HTML>')
                .join(_fobj.tp_html);
        _fobj.source = _source;
        return _source;
    };
    var _doMergeModule = function(_file,_data){
    	var _fobj = _data[_file];
    	if (!_fobj) return;
    	var _list = _fobj.tp_mdl;
    	if (!_list||!_list.length) return;
    	var _input = _config.get('DIR_SOURCE');
    	for(var i=0,l=_list.length,_src;i<l;i++){
    		_src = _list[i];
    		_list[i] = util.format(_tmpl,
    			      _src.replace(_input,''),
    			      _data[_src].source);
    	}
    	_fobj.source = _fobj.source.split('#<TP_MDL>').join(_list.join(''));
    };
    var _doFixSource = function(_result){
        var _files = _result.files,
            _outpt = _config.get('DIR_OUTPUT');
        for(var x in _files){
            _files[x].source = 
            _files[x].source.replace(_reg1,
                function($1,$2,$3){
                    var _count = parseInt($2),
                        _file = _doVersionResource($3);
                    if (isNaN(_count))
                        return _doRelativePath($2,_doOutputPath(x),_file);
                    var _from = _outpt+new Array(_count).join('xx/')+'xx';
                    return _doRelativePath('',_from,_file);
                });
        }
    };
    return function(_result){
        // fix resource before embed template
        __doParseHtmlResource(_result);
        // merge template
        var _files = _result.files;
        for(var x in _files){
            _doMergeHTML(x,_files,{});
        }
        for(var x in _files){
            _doMergeModule(x,_files);
        }
        // fix resource after embed template
        __doParseHtmlResource(_result);
        // parse resource/js/css src
        _doFixSource(_result);
    };
})();
/*
 * 合并模块模板版本信息
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doMergeVersion = function(_result){
    var _output = _config.get('DIR_OUTPUT');
    if (!_result.version)
        _result.version = {
            ver:{},
            root:_output.replace(_config.get('DIR_WEBROOT'),'/')
        };
    var _files = _result.files,_md5,_value,
        _input = _config.get('DIR_SOURCE'),
        _root  = _result.version.root,
        _cfgroot = _config.get('DM_STATIC_MR'),
        _version = _result.version.ver,
        _manifest = _result.manifest;
    // for manifest
    for(var x in _files){
        if (x.indexOf(_input)<0) continue;
        _md5 = _doVersionFile(_files[x].source);
        _value = x.replace(_input,'');
        _manifest[_root+_value] = _md5;
        if (_value.indexOf('#<VERSION>')<0)
            _version[_value] = _md5;
    }
    var _source,_relatived = _config.get('DM_STATIC_RR'),
        _version = {ver:_result.version.ver,root:_result.version.root},
        _template = '<script type="text/javascript">location.config = %j;</script>';
    for(var x in _files){
        _source = _files[x].source;
        if (_source.indexOf('#<VERSION>')<0)
            continue;
        if (!!_cfgroot){
        	_version.root = _cfgroot;
        }else if (_relatived){
        	_version.root = _doRelativePath('',_doOutputPath(x),_output);
        }
        _files[x].source = _source.replace('#<VERSION>',
                            util.format(_template,_version));
    }
};
/*
 * 调整链接地址
 * @param  {Object} 结果集
 * @return {Void}
 */
var __doMergeExlink = (function(){
    var _reg0 = /(\s+(?:src|href)\s*=\s*['"])(.*?)(['"])/gi;
    var _doParsePath = function(_path,_file){
        if (!_path||_path.indexOf('#')==0) return;
        var _source = _config.get('DIR_SOURCE'),
            _output = _config.get('DIR_OUTPUT'),
            _webrot = _config.get('DIR_WEBROOT'),
            _abpath = _doAbsolutePath(_path,path.dirname(_file)+'/');
        if (_abpath.indexOf(_source)<0) return;
        var _result = _abpath.replace(_source,_output).replace(_webrot,'/');
        _log.debug('adjust outlink %s -> %s',_path,_result);
        return _result;
    };
    return function(_result){
        if (!_config.get('X_AUTO_EXLINK_PATH')) return;
        var _files = _result.files,_file,
            _regud = _config.get('X_AUTO_EXLINK_REG');
        for(var x in _files){
            _file = _files[x];
            _file.source = (_file.source||'').replace(
                _reg0,function($1,$2,$3,$4){
                    var _new = _doParsePath($3,x);
                    if (!_new) return $1;
                    return util.format('%s%s%s',$2,_new,$4);
                }
            );
            if (!_regud) continue;
            _file.source = (_file.source||'').replace(
                _regud,function($1,$2,$3,$4){
                    var _new = _doParsePath($3,x);
                    if (!_new) return $1;
                    return util.format('%s%s%s',$2,_new,$4);
                }
            );
        }
    };
})();
/*
 * 输出样式
 * @param  {String} _name   类型,css/js
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doOutputFile = (function(){
    var _reg0 = /^(?:tp|pg)_/i,
        _reg1 = /[\/\-]/g,
        _reg2 = /\.[^.]+?$/i,
        _prefix = ['p','t'],
        _dirname = ['DIR_SOURCE','DIR_SOURCE_TP'];
    var _filename = function(_file){
        _file = _file.replace(_reg0,'');
        for(var i=0,l=_dirname.length,_dir;i<l;i++){
            _dir = _config.get(_dirname[i]);
            if (!!_dir&&_file.indexOf(_dir)>=0){
                _file = _prefix[i]+'_'+_file.replace(_dir,'');
                break;
            }
        }
        return _file.replace(_reg1,'_').replace(_reg2,'');
    };
    var _file2url = function(_file){
        return _file.replace(_config.get('DIR_WEBROOT'),'/');
    };
    return function(_name,_result){
        var _out = _result.output,
            _data = _out[_name],
            _sufix = _config.get('NAME_SUFFIX'),
            _outpt = _config.get('DIR_OUTPUT_STATIC'),
            _option = {type:_name=='css'?'cs':'js',mode:0};
        // output core
        if (!!_data.core){
        	_out[_name+'_code'] = _data.core;
            var _file = util.format('%score%s.%s',_outpt,_sufix,_name),
                _info = __doExlineFile(_file,_data.core,_option);
            _data.core = _info.link;
            _result.manifest[_file2url(_file)] = _info.version;
        }
        // output page
        var _content,_file,_info,
            _maxsize = _config.get('OBF_MAX_'+
                       _option.type+'_INLINE_SIZE')*1000;
        for(var x in _data){
            if (x=='core') continue;
            _content = _data[x];
            if (!_content) continue;
            _option.mode = x.indexOf('tp_')==0?1:0;
            _option.html = x.substring(3);
            if (_content.length>_maxsize){
                _file = util.format('%s%s%s%s.%s',_outpt,
                                    _prefix[_option.mode],
                                    _filename(x),_sufix,_name);
                _info = __doExlineFile(_file,_content,_option);
                _data[x] = _info.link;
                _result.manifest[_file2url(_file)] = _info.version;
            }else{
                _content = __doParseCSResource(x,_content,!0);
                _data[x] = __doInlineFile(_content,_option);
            }
        }
    };
})();
/*
 * 输出html代码
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doOutputHtml = function(_result){
    var _output,
        _files = _result.files,
        _charset = _config.get('FILE_CHARSET');
    for(var x in _files){
        _output = _doOutputPath(x);
        _fs.mkdir(path.dirname(_output)+'/');
        _log.info('output %s',_output);
        _fs.write(_output,_files[x].source,_charset);
    }
};
/*
 * 输出HTML5离线配置文件
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doOutputManifest = (function(){
    var _template = ['CACHE MANIFEST'
                    ,'#VERSION = #<VERSION>',''
                    ,'CACHE:','#<CACHE_LIST>',''
                    ,'NETWORK:','*',''
                    ,'FALLBACK:',''].join('\n');
    return function(_result){
        var _file = _config.get('DIR_MANIFEST');
        if (!_file) return;
        var _arr = [],_brr = [],
            _data = _result.manifest;
        for(var x in _data){
            _arr.push(x);        // url
            _brr.push(_data[x]); // version
        }
        var _content = _template.replace('#<CACHE_LIST>',_arr.join('\n'))
                                .replace('#<VERSION>',_doVersionFile(_brr.sort().join('.')));
        _log.info('output %s',_file);
        _fs.write(_file,_content,_config.get('FILE_CHARSET'));
    };
})();
/**
 * 输出结果
 * @param  {Object} _result 解析结果集
 * @return {Void}
 */
var __doOutput = function(_result){
    __doOutputFile('css',_result);
    __doOutputFile('js',_result);
    __doMergeCSandJS(_result);
    __doMergeTemplate(_result);
    __doMergeVersion(_result);
    __doMergeExlink(_result);
    __doOutputHtml(_result);
    __doOutputManifest(_result);
    if (!_config.get('X_NOT_CLEAR_TEMP'))
        _fs.rmdir(_config.get('DIR_TEMPORARY'));
    _log.info('release done! view release log %s',_config.get('DIR_LOGGER'));
};
// export api
exports.html     = __doListHtmlFile;
exports.template = __doListHtmlFile;
exports.download = __doDownloadResource;
exports.cs       = __doPrepareCS;
exports.js       = __doPrepareJS;
exports.output   = __doOutput;