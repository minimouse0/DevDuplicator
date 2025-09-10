import * as http from 'http'
import * as https from 'https'

interface HTTPResult{
    statusCode:number,
    headers:any,
    responseData:string,
}

/**
 * 拆解URL为四个部分：协议、主机名、端口号和路径。
 * @param url - 待解析的URL字符串。
 * @returns - 包含拆解后部分的JavaScript对象。
 */
function parseUrl(url:string) {
    // 定义结果对象，所有属性都有默认值
    const result:{
        protocol?:string,
        hostname:string,
        port?:number,
        path?:string
    } = {
        hostname: ''
    };

    // 如果URL为空或不是字符串，直接返回默认值
    if (!url || typeof url !== 'string') {
        return result;
    }

    // 1. 拆分协议
    // 检查是否以 "://" 开头
    const protocolMatch = url.match(/^([a-zA-Z]+:)?\/\//);
    if (protocolMatch) {
        result.protocol = protocolMatch[1] ? protocolMatch[1]+"//" : '';
        // 移除协议部分，继续解析剩余部分
        url = url.substring(protocolMatch[0].length);
    }

    // 2. 拆分主机名、端口和路径
    // 查找第一个斜杠 "/"，它通常是主机名和路径的分界线
    const pathIndex = url.indexOf('/');
    let hostAndPort = url;
    if (pathIndex !== -1) {
        // 存在路径，拆分出主机和路径
        hostAndPort = url.substring(0, pathIndex);
        result.path = url.substring(pathIndex);
    }

    // 3. 拆分主机名和端口号
    // 查找冒号 ":"，它通常是主机名和端口的分界线
    const portIndex = hostAndPort.indexOf(':');
    if (portIndex !== -1) {
        // 存在端口号
        result.hostname = hostAndPort.substring(0, portIndex);
        result.port = parseInt(hostAndPort.substring(portIndex + 1));
    } else {
        // 没有端口号，整个部分都是主机名
        result.hostname = hostAndPort;
    }

    return result;
}


export class SimpleHTTPReq{
    static async GET(url:string,options?:{
        
    }){
        let {hostname,path,protocol,port}=parseUrl(url)
        if([undefined,""].includes(path))path="/"
        //协议不存在时需要自行检查是否能够连接
        if(protocol==undefined){
            //优先请求https
            const HTTPSReqResult=await (async ()=>{
                try{
                    return await SimpleHTTPReq.strictGET("https://",hostname,port==undefined?443:port,path,{...options,timeout:5000})
                }
                catch(e){
                    if(e.code==='ETIMEDOUT')return undefined;
                    else throw new Error("尝试请求"+url+"时发生了未知错误：\n"+e)
                }
            })()
            //请求失败，回退到http
            if(HTTPSReqResult==undefined){
                const HTTPReqResult=await SimpleHTTPReq.strictGET("http://",hostname,port==undefined?80:port,path)
                if(HTTPReqResult.statusCode==200)console.log("HTTPS请求失败，但HTTP请求成功。如果不希望每次都等待这么长时间才响应，请在配置文件中加上http://协议前缀。")
                return HTTPReqResult
            }
            //请求成功，直接返回结果
            else{
                return HTTPSReqResult
            }
        }
        //已经提供协议，那么直接按协议来
        else{
            return await SimpleHTTPReq.strictGET(protocol,hostname,port==undefined?defaultPortFromProtocol(protocol):port,path,options)
        }
    }
    static async POST(url:string,headers:any,data:string | Buffer<ArrayBufferLike>,options?:{
        
    }){
        let {hostname,path,protocol,port}=parseUrl(url)
        if([undefined,""].includes(path))path="/"
        //协议不存在时需要自行检查是否能够连接
        if(protocol==undefined){
            //优先请求https
            const HTTPSReqResult=await (async ()=>{
                try{
                    return await SimpleHTTPReq.strictPOST("https://",hostname,port==undefined?443:port,path,data,headers,{...options,timeout:5000})
                }
                catch(e){
                    if(e.code==='ETIMEDOUT')return undefined;
                    else throw new Error("尝试请求"+url+"时发生了未知错误：\n"+e)
                }
            })()
            //请求失败，回退到http
            if(HTTPSReqResult==undefined){
                const HTTPReqResult=await SimpleHTTPReq.strictPOST("http://",hostname,port==undefined?80:port,path,data,headers,options)
                if(HTTPReqResult.statusCode==200)console.log("HTTPS请求失败，但HTTP请求成功。如果不希望每次都等待这么长时间才响应，请在配置文件中加上http://协议前缀。")
                return HTTPReqResult
            }
            //请求成功，直接返回结果
            else{
                return HTTPSReqResult
            }
        }
        //已经提供协议，那么直接按协议来
        else{
            return await SimpleHTTPReq.strictPOST(protocol,hostname,port==undefined?defaultPortFromProtocol(protocol):port,path,data,headers,options)
        }
    }
    private static async strictGET(protocol:string,hostname:string,port:number,path:string,otherOptions={}){
        const chosenHTTPModule=(()=>{
            switch(protocol){
                case "http://":return http;
                case "https://":return https;
                default:throw new Error("无法识别的协议前缀："+protocol)
            }

        })()
        const options = {
            hostname, // 替换为你自己的服务器地址
            port,
            path,
            method: 'GET'
        };
        return await new Promise<HTTPResult>((resolve,reject)=>{
            const result:HTTPResult={
                statusCode:-1,
                headers:{} as any,
                responseData:"",
            }
            const req = chosenHTTPModule.request({...options,...otherOptions}, res => {
                result.statusCode=res.statusCode
                result.headers=res.headers

                let responseData = '';

                // 监听 'data' 事件，处理接收到的数据分片
                res.on('data', (chunk) => {
                    // chunk 是一个 Buffer 对象，表示一个数据分片
                    // console.log(`接收到数据分片，大小: ${chunk.length} 字节`);
                    responseData += chunk.toString(); // 将 Buffer 转换为字符串并拼接
                });

                // 监听 'end' 事件，表示所有数据已接收完毕
                res.on('end', () => {
                    result.responseData=responseData
                    resolve(result)
                });
            });

            req.on('error', (e) => {
                reject(e);
            });
            // 结束请求，如果请求是 GET，可以不发送数据体
            req.end();            
        })
    }

    private static async strictPOST(
        protocol: string,
        hostname: string,
        port: number,
        path: string,
        data: string | Buffer,
        headers: any,
        otherOptions: {}
    ): Promise<HTTPResult> {
        // 1. 选择 http/https 模块
        const chosenHTTPModule = (() => {
            switch (protocol) {
                case 'http://': return http;
                case 'https://': return https;
                default:
                    throw new Error(`无法识别的协议前缀: ${protocol}`);
            }
        })();

        // 2. 构建基础 options，并计算 Content-Length
        const bodyBuffer = typeof data === 'string' ? Buffer.from(data) : data;
        const options: http.RequestOptions = {
            hostname,
            port,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(bodyBuffer),
                ...headers
            },
            ...otherOptions
        };

        // 3. 发起 POST 请求
        return new Promise<HTTPResult>((resolve, reject) => {
            const result: HTTPResult = {
                statusCode: -1,
                headers: {},
                responseData: ''
            };

            const req = chosenHTTPModule.request(options, res => {
                result.statusCode = res.statusCode ?? -1;
                result.headers = res.headers;

                let responseData = '';
                res.on('data', chunk => {
                    responseData += chunk.toString();
                });
                res.on('end', () => {
                    result.responseData = responseData;
                    resolve(result);
                });
            });

            req.on('error', err => {
                reject(err);
            });

            // 4. 一次性写入完整请求体并结束请求
            //后续打算做检测到数据量过大则自动分片上传
            req.write(bodyBuffer);
            req.end();
        });
    }

}

function defaultPortFromProtocol(protocol:string){

    switch(protocol){
        case "http://":return 80;
        case "https://":return 443;
        default:throw new Error("无法识别的协议前缀："+protocol)
    }
}