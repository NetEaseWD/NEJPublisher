NEJ项目发布器使用说明
1. 安装NodeJS环境（http://nodejs.org/）
2. 将release/deploy/下的内容拷贝至项目中
   - windows下执行文件为.bat文件，其他平台为.sh文件
3. 用文本编辑器打开修改.bat或者.sh文件中的release.js和release.conf文件的路径
   - bat文件中的%~dp0表示当前bat文件所在的目录路径
4. 修改配置文件release.conf，配置文件各配置参数说明见配置文件中的注释
5. 执行.bat或者.sh文件发布项目

注：如果项目有统一的build脚本可将打包的执行命令写入build中,[]路径根据实际情况替换
   node [PATH_OF_RELEASE_SRC]release.js -c=[PATH_OF_RELEASE_CONFIG]release.conf