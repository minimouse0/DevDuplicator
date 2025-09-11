//整体思路：首先自己作为客户端，向dls高速请求
//通过dlsapi.ts,可以实现对控制台变化的监听，只在控制台变化时发消息
//这样的话就可以避免轮询造成的巨大网络开销，也能避免dls内置http服务的局限性
//有了这些作为基础之后，再做dls的监听就好办了
//测试方式，在codeserver上运行服务端程序
//然后在termux内做简易客户端进行测试
//后面这个客户端成熟了，就直接放到远程服务器上就行了
//首先，实现dls获取远程服务器数据并打印到控制台即可
import { DLSAPI } from "./dlsapi.js";
import * as ws from "ws";
const session=new DLSAPI("http://localhost:57317/231t/dlswebconsole_api","231TTheOne2");
session.postConsoleRefresh.push(newInfo=>{
    newInfo.logsAppended.forEach(log=>console.log(log.text));
    server.clients.forEach(client => {
        if(client.readyState===WebSocket.OPEN){
            client.send(JSON.stringify({
                type:"console_update",
                data:newInfo.logsAppended
            }))
        }
    });
})
session.start();
//先做ws,ws好做
const server=new ws.Server({port:18535});
server.on("connection",socket=>{
    socket.on("message",data=>{
        console.log("收到客户端消息："+data)
    })
})