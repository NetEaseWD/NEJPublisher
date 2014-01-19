//convienence function(src, [options]);
var fs = require("fs"),
	path = require("path");
	
//orign_codes
//input:
//		hash_code_orgin:{'001':'orgin_code','002':'orgin_code','003','orgin_code'}
//		hash_group_config:{'a.js':['001','002'],'b.js':['001','002','003'],'c.js':['003']}
//output
//		hash_code:{'a.js':['001 code','002 code'],'b.js':['001 code','002 code','003 code']}
function uglify_main(hash_code_orgin,hash_group_config,options){
	options||(options={});
  	var jsp = uglify.parser,
		pro = uglify.process,
		hash_code_ast={},//语法树hash表
		list_code_ast=[],//语法树列表
		hash_group_result={},//返回混淆后结果分组
		list_code_result=[],//分组代码列表
		hash_identifier_map={},//混淆结果对照表
		code_ast,//语法树
		code_orgin,//源代码
		count_identifiers,//标识符统计结果
		regexp_null = /^\s*;?$/,//处理空文件
		regexp_function = /^\s*\(\s*function\s*\(\s*\)\s*{\s*}\s*\)\s*\(\s*\)\s*;?$/;//处理空函数
	//处理空内容或者空函数
	for(var key in hash_code_orgin){
		code_orgin = hash_code_orgin[key];
		if((regexp_null.test(code_orgin))||(regexp_function.test(code_orgin))){
			delete hash_code_orgin[key];
			for(var group in hash_group_config){
				for(var i=hash_group_config[group].length-1;i>=0;i--){
					if(hash_group_config[group][i]===key){
						hash_group_config[group].splice(i,1);
					}
				}
			}
			
		}
	}
	time_it('parsing js',function(){
		for(var key in hash_code_orgin){
			try{
				code_ast = jsp.parse(hash_code_orgin[key], options.strict_semicolons);
			}catch(e){
			    var s = hash_code_orgin[key].split('\n'),
			        a = [],
			        i = Math.max(0,e.line-10),
			        l = Math.min(e.line+10,s.length);
			    for(var k;i<l;i++){
			        k = i+1;
			        a.push((k==e.line?'->\t':'\t')+k+':\t'+s[i]);
			    }
				console.log('[UGLIFYJS] SOURCE CODE AT: \n'+a.join('\n'));
				console.log('[UGLIFYJS] PARSE ERROR: '+e.message +' AT LINE:'+e.line+' COL:'+e.col);
			}
			list_code_ast.push(code_ast);
			hash_code_ast[key]=code_ast;
		}
	});
	if(options.obf_level===0){
		for(var key in hash_group_config){
			list_code_result=[];
			for(var i=0;i<hash_group_config[key].length;i++){
				code_ast = hash_code_ast[hash_group_config[key][i]];
				list_code_result.push(pro.gen_code(code_ast,options.gen_options));
			}
			hash_group_result[key]=list_code_result;
		}
	}else{
		time_it('counting variable',function(){
			//console.log(JSON.stringify(combine_ast(list_code_ast)));
			count_identifiers = pro.ast_preprocess(combine_ast(list_code_ast),options);
		});
		time_it('confusing variable and generating code',function(){
			for(var key in hash_group_config){
				list_code_result=[];
				for(var i=0;i<hash_group_config[key].length;i++){
					code_ast=pro.ast_mangle(hash_code_ast[hash_group_config[key][i]],count_identifiers,options);
					list_code_result.push(pro.gen_code(code_ast,options.gen_options));
				}
				hash_group_result[key]=list_code_result;
			}
		});
		for(var i=0,identifier;i<count_identifiers.list_confuse_identifier.length;i++){
			identifier=count_identifiers.list_confuse_identifier[i];
			hash_identifier_map[identifier.id]=identifier.st;
		}
	}
	return {code:hash_group_result,map:hash_identifier_map};
}
//generate by directory
//input directory
function generate_by_dir(dir_path,options){
	var hash_code_orgin={},//源码列表
		hash_group_config={},//打包分组列表
		file_list,//文件列表
		uglify_result,//混淆压缩结果 
		output_path,//输出路径
		map_str,//标识符对照表字符串
		out_filename;//生成的文件名
	dir_path = (dir_path.lastIndexOf('/')!==dir_path.length-1)?
				dir_path:dir_path.substr(0,dir_path.length-1);
	output_path = options.out_dir;
	if(!!output_path){
		output_path = (output_path.lastIndexOf('/')===output_path.length-1)?
				output_path:(output_path+'/');
	}
	output_path = output_path||(dir_path.substr(0,dir_path.lastIndexOf('/')+1)+'gen/');
	if(!path.existsSync(output_path)){
		fs.mkdirSync(output_path,'0777');
	}
	if(path.existsSync(output_path+'_map_.js')){
		map_str = fs.readFileSync(output_path+'_map_.js',"utf8").toString();
		if(!!map_str){
			options.identifier_map=JSON.parse(map_str);
		}
	}
	file_list=traversal_dir(dir_path);
	for(var i=0;i<file_list.length;i++){
		out_filename=file_list[i].replace(dir_path.substr(0,dir_path.lastIndexOf('/')+1),'').replace(/\//g,'_');
		hash_code_orgin[out_filename] = fs.readFileSync(file_list[i],"utf8");
		hash_group_config[out_filename]=[out_filename];
	}
	uglify_result = uglify_main(hash_code_orgin,hash_group_config,options);
	for(var file in uglify_result.code){
		if(!!uglify_result.code[file][0]){
			output(uglify_result.code[file][0],output_path+file,'js');
		}
	}
	output(JSON.stringify(uglify_result.map),output_path+'_map_.js');
	console.log('[UGLIFYJS] success');	
}
//generate by group
function generate_by_group(group_config,options){
	var map_config=options.code_map||{},//代码分组查找表 
		map_str,//标识符对照表字符串
		hash_code_orgin={},//源码列表
		hash_group_config={},//打包分组列表
		hash_code_map={},//新旧键值对照表
		code_orgin,//js代码
		start_key=100000,//开始标示 
		next_key,//下一个标示
		uglify_result,//压缩混淆结果
		output_path=options.out_dir;//输出路径 
	if(path.existsSync(output_path+'_map_.js')){
		map_str = fs.readFileSync(output_path+'_map_.js',"utf8").toString();
		if(!!map_str){
			options.identifier_map=JSON.parse(map_str);
		}
	}
	for(var key in group_config){
		hash_group_config[key]=[];
		for(var i=0;i<group_config[key].length;i++){
			if(!!hash_code_map[group_config[key][i]]){
				hash_group_config[key][i] = hash_code_map[group_config[key][i]];
			}else{
				next_key = (start_key++)+'';
				hash_group_config[key][i] = next_key;
				hash_code_map[group_config[key][i]]=next_key;
				if(map_config[group_config[key][i]]!=null){//maybe file path
					code_orgin=map_config[group_config[key][i]];;
				}else{
					code_orgin=fs.readFileSync(group_config[key][i],"utf8");
				}
				hash_code_orgin[next_key]=code_orgin;
			}
		}
	}
	uglify_result = uglify_main(hash_code_orgin,hash_group_config,options);
	for(var file in uglify_result.code){
		output(uglify_result.code[file].join(options.obf_line_mode===1?';\n':''),output_path+file,'js');
	}
	output(JSON.stringify(uglify_result.map),output_path+'_map_.js');
	console.log('[UGLIFYJS] success');
}
//generate by group output code
function generate_by_group_outcode(group_config,options){
	var map_config=options.code_map||{},//代码分组查找表 
		hash_code_orgin={},//源码列表
		hash_group_config={},//打包分组列表
		hash_code_map={},//新旧键值对照表
		code_orgin,//js代码
		start_key=100000,//开始标示 
		next_key,//下一个标示
		uglify_result;//压缩混淆结果
	options.identifier_map = options.bags;
	for(var key in group_config){
		hash_group_config[key]=[];
		for(var i=0;i<group_config[key].length;i++){
			if(!!hash_code_map[group_config[key][i]]){
				hash_group_config[key][i] = hash_code_map[group_config[key][i]];
			}else{
				next_key = (start_key++)+'';
				hash_group_config[key][i] = next_key;
				hash_code_map[group_config[key][i]]=next_key;
				if(map_config[group_config[key][i]]!=null){
					code_orgin=map_config[group_config[key][i]];
				}else{
					code_orgin=fs.readFileSync(group_config[key][i],"utf8");
				}
				hash_code_orgin[next_key]=code_orgin;
			}
		}
	}
	uglify_result = uglify_main(hash_code_orgin,hash_group_config,options);
	for(var file in uglify_result.code){
		uglify_result.code[file]=uglify_result.code[file].join(options.obf_line_mode===1?';\n':'')
	}
	console.log('[UGLIFYJS] success');
	return {files:uglify_result.code,bags:uglify_result.map};	
}
// combine ast list to one
function combine_ast(ast_list){
	var result_ast=["toplevel",[]];
	for(var i=0;i<ast_list.length;i++){
		for(var j=0;j<ast_list[i][1].length;j++){
			result_ast[1].push(ast_list[i][1][j]);
		}
	}
	return result_ast;
}
//create directory
function create_directory(filename){
	var parts = filename.split('/'),tmp_path;
	for(var i=2;i<parts.length;i++){
		tmp_path=parts.slice(0,i).join('/');
		if(!path.existsSync(tmp_path)){
			console.log('[UGLIFYJS] create directory:'+tmp_path);
			fs.mkdirSync(tmp_path,'0777')
		}
	}
}
//output file
function output(texts,filename,type){
	console.log('[UGLIFYJS] writing file:'+filename);
	create_directory(filename);
    var out = fs.createWriteStream(filename,{flags: "w",encoding:"utf8",mode:0644});
    if(type==='js'){
		out.write(texts.replace(/;*$/, ";"));
	}else{
		out.write(texts);
	}
    out.end();
};
//time it
function time_it(name, cont) {
    var t1 = new Date().getTime();
    try{return cont();}
    finally{ console.log('[UGLIFYJS] '+name + " done in: " + ((new Date().getTime() - t1) / 1000).toFixed(3) + " sec."); }
};
//traversal a directory
function traversal_dir(currentPath) {
	var result_list=[];
   	function traversal(currentPath){
		var files = fs.readdirSync(currentPath),currentFile,stats;
	    for (var i in files) {
	       currentFile = currentPath + '/' + files[i];
	       stats = fs.statSync(currentFile);
	       if(stats.isFile()&&path.extname(currentFile)=='.js'){
	     		result_list.push(currentFile);
	       }else if(stats.isDirectory()) {
	       		arguments.callee(currentFile);
	       }
	    }
	}
	traversal(currentPath);
	return result_list;
};
uglify={}
uglify.parser = require("./lib/parse");
uglify.process = require("./lib/process");
uglify.generate_by_group_outcode = generate_by_group_outcode;
uglify.generate_by_group = generate_by_group;
uglify.generate_by_dir = generate_by_dir;

module.exports = uglify