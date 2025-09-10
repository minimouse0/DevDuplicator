import * as readline from 'readline'

let rl:readline.Interface|undefined;
let userInputListeners:((input:string)=>void)[]=[]
export function start(){
    if(rl!=undefined)return;
    // 创建 readline 接口
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: ''
    });
    //由于一些我也不知道的原因，rl.prompt之后不会被立即显示出来，需要先敲一行命令才行
    //rl.prompt();
    // 监听每一行输入
    rl.on('line', (input) => {
        const command = input.trim();

        if (command.toLowerCase() === 'exit') {
            console.log('正在退出DLSDeepSleepManager。');
            rl.close();
        } else {
            //console.log(`你输入了命令: ${command}`);
            userInputListeners.forEach(fn=>fn(command))
            //rl.prompt();
        }
    });
    // 监听关闭事件
    rl.on('close', () => {
        process.exit(0);
    });
}

export function onUserInput(callback:(input:string)=>void){
    userInputListeners.push(callback);
}
