import { SimpleHTTPReq } from "./http";

type DLSAPIErrorReason=
    "PATHINVALID"
    |"NETWORKTIMEDOUT"
    |"UNKNOWN"
    |"INCORRECTTOKEN"
    |"UNEXPECTEDSTATUS"
    |"OUTDATEDAPIVERSION"
    |"BUG"
export class DLSAPIError extends Error{
    code:DLSAPIErrorReason
    HTTPStatusCode:number|undefined
    constructor(msg:string,code:DLSAPIErrorReason,HTTPStatusCode?:number){
        super(msg)
        this.code=code;
        this.HTTPStatusCode=HTTPStatusCode
    }
}

export interface DLSLog{
    log_id:number,
    time?:number,
    text:string,
    color_text:string,
    clientRemark?:string
}

export class DLSAPI{
    private root:string
    private token:string
    private logs:DLSLog[]=[]
    private running:boolean=false
    private refreshLoop:AsyncLoop
    set refreshInterval(interval:number){
        this.refreshLoop.interval=interval
    }
    get refreshInterval(){
        return this.refreshLoop.interval
    }
    //public preConsoleRefresh //用于拦截
    public postConsoleRefresh:((newInfo:{
        logsAppended:DLSLog[]
    })=>void)[]=[]
    /**constructor调用时是未连接的状态，如果要一次性调用+验证，需要使用静态方法 */
    constructor(url:string,token:string){
        this.token=token
        //注意运算符优先级
        this.root=url+(url.endsWith("/")?"":"/");
        //初始化循环，间隔默认为1000ms
        this.refreshLoop=new AsyncLoop(this.refresh.bind(this),1000)
    }
    public async start(){
        if(this.running)return;
        //首先需要发送一次请求（直接刷新控制台）来确保连接成功，然后把这个日志解析出来，解析出来这个日志之后存进数据里面
        //因为start可能在中途停止后重新启动，所以旧日志不一定为空，需要调用正常的合并方法
        await this.refreshConsole()
        //随后开始正式地刷新
        this.refreshLoop.start()
        this.running=true;
    }
    public async stop(){
        this.refreshLoop.stop()
        this.running=false;
    }
    public async refresh(){
        //分别刷新控制台日志、服务器硬件状态和服务器开启状态
        await this.refreshConsole();
        //await refreshHardwareStatus();
        //await refreshProcessStatus
    }
    public async refreshConsole(){
        let logsAppended:DLSLog[]=[]
        //获取日志并合并到现有日志里
        //从现有日志的末尾开始获取（末尾必然是最新的）
        //如果把我所拥有的日志的最后一条发给dls，那么dls将从那条日志的下一条开始发给我
        //当心this.logs为空！！！
        const 旧日志的最后一项的log_id=this.logs.length==0?0:this.logs[this.logs.length-1].log_id
        const {旧日志最后一项的新索引}=this.concatLogs(await this.terminal_log(旧日志的最后一项的log_id));
        //拼接完了之后，检查是否在后方添加了新日志
        //现在已经有了新索引的位置，那么直接对比新索引是否仍然在末尾
        //如果是在末尾的情况，那么证明后方没有新产生的日志
        //如果已经不在末尾了，证明有新日志，那么返回旧日志最后一项的新索引之后到当前新日志末尾的全部内容
        if(旧日志最后一项的新索引!=this.logs.length-1){
            if(旧日志最后一项的新索引>this.logs.length-1)throw new DLSAPIError("算法有误！","BUG")
            else logsAppended=this.logs.slice(旧日志最后一项的新索引+1,this.logs.length)
        }
        //调用回调函数
        this.postConsoleRefresh.forEach(fn=>fn(
        {
            logsAppended
        }))
    }
    public async terminal_log(log_id:number):Promise<DLSLog[]>{
        const consoleFromTopRaw=await (async()=>{
            try{
                return await SimpleHTTPReq.GET(this.root+"terminal_log?token="+this.token+"&log_id="+log_id);
            }
            catch(e){
                if(e.code==="ETIMEDOUT")throw new DLSAPIError("请求"+this.root+"超时。","NETWORKTIMEDOUT")
                throw new DLSAPIError("请求"+this.root+"时发生未知错误。","UNKNOWN")
            }
        })()
        //服务器返回404证明路径错误
        if(consoleFromTopRaw.statusCode===404)throw new DLSAPIError("填写的API的URL "+this.root+"不正确","PATHINVALID",404)
        if(consoleFromTopRaw.statusCode===403)throw new DLSAPIError("token不正确，请检查","INCORRECTTOKEN",403)
        //所有的300状态码都已经在底层的http请求中被自动重定向
        if(consoleFromTopRaw.statusCode/100!==2)throw new DLSAPIError("状态码"+consoleFromTopRaw.statusCode+"不应由DLSAPI发出","UNEXPECTEDSTATUS",consoleFromTopRaw.statusCode)
        return JSON.parse(consoleFromTopRaw.responseData).log_list
    }
    private concatLogs(newLogs:DLSLog[]):{
        /** **可能为-1！！！** */
        旧日志最后一项的新索引:number
    }{
        //只有在旧日志的中间插入时才需要动这个变量
        //旧日志为空时值为-1
        let 旧日志最后一项的新索引=this.logs.length-1;
        //如果本来就为空，那么无需修改，直接退出即可
        if(newLogs.length==0)return {旧日志最后一项的新索引};
        //如果旧日志为空，那么直接把新日志整个放进旧日志，然后跳过后面步骤
        if(this.logs.length==0){
            this.logs.push(...newLogs)
            return {旧日志最后一项的新索引};
        }
        //分析日志的时间
        //首先将日志按时间进行排序
        //如果长度只有一，那么后面的sort函数会自动跳过排序，无需额外性能优化
        try{
            newLogs=DLSAPI.sortLogs(newLogs)
        }
        catch(e){
            if(e.code==="OUTDATEDAPIVERSION"){
                console.error(e.message);
                console.error("因此，刷新控制台日志的任务已被强制停止。")
                this.stop()
            }
            //如果错误为预期之外的，就直接抛出，不额外提示，程序也没必要继续运行了
        }
        //然后从新日志的头开始，与旧日志合并，直到新日志中的日志开始完全位于旧日志之后
        //遍历新日志，然后一个一个地添加到旧日志之中
        //默认使用0，因为倒序时是不会遍历到0的，如果整个循环都没有写入这个值，那么证明已经超出
        //使用-1是因为在这种情况下它都比经比0小了那它只能比-1大，因为-1在数组索引中是非法的，不可能有东西
        //此变量要在下文中根据本次循环计算结果被修改并循环使用，所以不能被包进循环内部
        let 新日志开头在旧日志中比哪个地方大=-1
        //遍历旧日志，使用新日志的开头进行寻找
        //由于新日志有极大可能位于旧日志后，所以倒序遍历
        for(let i=this.logs.length-1;i>=0;i--){
            //如果新日志开头比此处的旧日志开头大（等于的情况较特殊，随便处理）
            //那么它一定位于此处和上一处的时间之间
            //如果它能同时大于上一处的时间，那么它将必然在上一次遍历中被检测到
            if(newLogs[0].time>=this.logs[i].time){
                新日志开头在旧日志中比哪个地方大=i;
                break;
            }
        }
        //从旧日志中那个被指定的位置，向旧日志中插入新日志
        //如果新日志被掏空了，那它连这个循环都不会进入
        //while的条件除了双重保险之外，还避免了新日志为空导致下文检查新日志内容时发生崩溃的情况
        //这个while会清空newLogs，所以它里面的break也必须是在newLogs为空时执行
        while(newLogs.length>0){
            //先执行插入操作
            //从新日志中用shift方法取出开头要被插入的日志元素
            const currentNewLogStart=newLogs.shift();
            //注意，此时那个比谁大的值可能是-1
            //如果是-1，证明上文程序行为已经可以推导出新日志不能被合并，
            //总的来说，合并（不执行插入操作）有以下情况：
            //比谁大不为-1，而且与前一条日志（比谁大）完全相同
            let mergeNewLog=false;
            if(新日志开头在旧日志中比哪个地方大!=-1){
                //合并检测，进行插入操作时校验该日志是否与前一条日志完全相同
                if(
                    this.logs[新日志开头在旧日志中比哪个地方大].time==currentNewLogStart.time
                    &&this.logs[新日志开头在旧日志中比哪个地方大].text==currentNewLogStart.text
                )mergeNewLog=true;//不执行插入操作
            }
            //如果新日志为-1，那么此处第一个参数传入0，目的类似unshift
            if(!mergeNewLog){
                //判断是否在旧日志的最后一项之前插入，如果是，那么需要将旧日志最后一项的新索引向后移一位
                if(新日志开头在旧日志中比哪个地方大<this.logs.length-1){
                    旧日志最后一项的新索引++;
                }
                // console.log(`执行splice操作：${新日志开头在旧日志中比哪个地方大+1},0,${currentNewLogStart.text}`)
                this.logs.splice(新日志开头在旧日志中比哪个地方大+1,0,currentNewLogStart)//条件不满足，执行插入
            }
            //如果newLogs插入完这个元素之后自己空了，那么不需要进行下一步，直接退出
            if(newLogs.length==0){
                // console.log("已插入完所有日志")
                break;
            }
            //图形化表述：
            //一次具体的插入操作完成后，此时的旧日志：
            //（新日志…大）旧日志时间1 新日志开头时间3 旧日志时间5 旧日志时间8
            //此时的新日志：
            //新日志时间7，比旧日志上条的时间大（也可能是4，比上条的时间小） 新日志时间9
            //否则，此时正常地开始一个循环（比谁大最小为0），该循环将从旧日志的插入点之前（旧日志被插入处的前段末尾）开始
            //插入与否决定了遍历的起点
            //不能以比之前的大为基准进行比较，因为肯定比之前的大，比较起来没有意义
            //必须得以后面为基准，它如果想向后挪，那必须得是它本身比后面的都大（倒序）它才挪
            //它必然是比它的上一个大的，那如果此时它发现它比后面的小，那证明它在这两个数中间
            //它同时 比上一个和下一个大 的情况证明它太晚，就需要继续往后挪
            //它不可能 比下一个大又比上一个小 ，这种情况数组轴上没有交集不能成立
            //它同时 比上一个和下一个小 的情况不存在，因为上文的处理已经决定了它不可能比上一个还小
            //如果它 比上一个大又比下一个小 ，证明它已经找到了属于它自己的位置
            //也就是说我只需要把它和下一个比大小
            //如果它比下一个小，证明它找到了属于它自己的位置
            //如果它比下一个大，证明它需要再往后一位，然后再判断一次
            //如果它等于下一个，那么下一步它将在此被合并，合并只处理上一个，那么把它向后一位，合起来就是大于等于
            //向后寻找直到日志结束
            //日志结束时，i+1刚好发生越界访问
            //然而日志马上结束时
            //如果仍然需要向后，那么这次向后之后就没有必要再次判断，因为它已经跑到数组后面
            //所以如果限制循环到最后一位的前一位
            //那么此时它在前一位判断自己比下一位还大，就会跑到数组后面并跑出循环
            else {
                let i=新日志开头在旧日志中比哪个地方大;
                for(;i<this.logs.length-1&&newLogs[0].time>=this.logs[i+1].time;i++){}
                // //原始结构
                // for(;i<this.logs.length-1;i++){
                //     //对比新日志新开头的时间和旧日志当前位置的下一个，如果比当前位置大，那么证明找到新插入点
                //     //如果它比下一个小，证明它找到了属于它自己的位置
                //     if(newLogs[0].time<this.logs[i+1].time){
                //         //这一步会将i冻结，使它不再被修改
                //         break;
                //     }
                //     //如果它比下一个大，证明它需要再往后一位，然后再判断一次
                //     //如果它等于下一个，那么下一步它将在此被合并，合并只处理上一个，那么把它向后一位，合起来就是大于等于
                // }
                新日志开头在旧日志中比哪个地方大=i;
            }
            //为了让程序在日志已经要被拼接时继续校验新日志的后续是否还与上文重复，此处不进行直接的拼合操作
            //如果比谁大已经位于旧日志末尾，那么上文将会检查新日志的开头是否与旧日志末尾重复，重复的话将继续合并
            //如果没重复的话，它将会正常的拼接一位到最后（splice第一个参数传入length属性的值相当于push）
            //如此往复直到用完新日志
        }
        return {
            旧日志最后一项的新索引
        }
    }
    static sortLogs(logs: DLSLog[]): DLSLog[] {
        return logs.sort((a, b) => {
            // 如果 time 都存在
            if (a.time !== undefined && b.time !== undefined) {
                return a.time - b.time; // 正常排序
            }
            //如果不存在，证明DLS返回的格式不正确，可能属于旧版DLS，直接报错
            else throw new DLSAPIError("DLS版本过旧，请使用1.9.51及更高版本的DLS！","OUTDATEDAPIVERSION")//
        });
    }
    public async execute(cmd:string[]){
        return await SimpleHTTPReq.POST(this.root+"execute",{
            "Content-Type": "application/json"
        },JSON.stringify({
            token:this.token,
            cmd
        }));
    }

}

class AsyncLoop{
    private af:(...args:any[])=>Promise<any>
    public interval:number
    private started=false;
    constructor(af:(...args:any[])=>Promise<any>,interval:number){
        this.af=af;
        this.interval=interval
    }
    private async startLoop(){
        //遇到started为false时会自动停止
        while(this.started){
            await this.af();
            await new Promise<void>(resolve=>setTimeout(resolve,this.interval))
        }
    }
    start(){
        this.started=true;
        this.startLoop();
        return this;
    }
    stop(){
        this.started=false;
        return this;
    }
}



            //那么此时发生的变化：新日志比谁大的值应该重新判断，因为不知道它是比5大还是比5小
            //那么此时判断新日志剩余的那个开头（7或4）是否比旧日志时间5更大
            //如果比旧日志时间5更小（4），那么证明新日志开头在旧日志中比新日志开头时间3更大
            // if(newLogs[0].time<=this.logs[新日志开头在旧日志中比哪个地方大+2].time){
                //这种情况将新日志开头在旧日志中比哪个地方大++
                //然而如果上文日志插入操作有合并行为，那么此处也需要跳过
                // if(!insertedLogMerged)新日志开头在旧日志中比哪个地方大++;
            // }
            //如果比旧日志时间5更大（7）
            // else{
                //这种情况开始一个循环，程序将寻找一个点，新日志的这个新开头的时间位于这个区间
                //这个循环将从
                //for(let i)
                //找到了之后，回答问题：新日志开头在旧日志中比哪个地方大？答：比这个区间的较小的那个点大
                //那么直接将这个点的靠前的那个索引赋值给新日志开头在旧日志中比哪个地方大
            // }