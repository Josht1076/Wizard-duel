import { fixture } from "./fixtures";
import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { exportData,filterData,metrics,replay,csv, type Dataset } from "./model";
const port=Number(process.env.WD_ANALYTICS_PORT||4310);
const demo=process.argv.includes('--demo');
const serverKey=(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
if (!demo && (!serverKey||!process.env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('Set SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) in .env.local, or use npm run analytics -- --demo');
const sb=demo?null:createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,serverKey,{auth:{persistSession:false,autoRefreshToken:false}});
async function dataset():Promise<Dataset> {
  if(demo) return fixture();
  const {data,error}=await sb!.rpc('wd_research_snapshot');
  if(error) throw new Error('Cannot read research snapshot; check service credentials and migration 004');
  return data as Dataset;
}
function send(res:ServerResponse,status:number,body:string,type='application/json'){
  res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});res.end(body);
}
createServer(async(req,res)=>{
  // Reject DNS rebinding, cross-origin requests and forwarded access. No state-changing endpoints.
  if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${port}`||req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['x-forwarded-for']) return send(res,403,'{"error":"local_only"}');
  try {
    const url=new URL(req.url!,'http://127.0.0.1');
    if(url.pathname==='/') return send(res,200,await readFile(new URL('./index.html',import.meta.url),'utf8'),'text/html');
    if(url.pathname==='/app.js') return send(res,200,await readFile(new URL('./app.js',import.meta.url),'utf8'),'text/javascript');
    if(!['/data','/export'].includes(url.pathname)) return send(res,404,'{}');
    const data=exportData(filterData(await dataset(),Object.fromEntries(url.searchParams)));
    if(url.pathname==='/data') return send(res,200,JSON.stringify({...data,metrics:metrics(data),replays:replay(data.records)}));
    const table=url.searchParams.get('table')||'replay';
    if(!['matches','exchanges','events','telemetry','replay'].includes(table)) return send(res,400,'{"error":"invalid_table"}');
    res.setHeader('Content-Disposition',`attachment; filename="wizard-duel-${table}.${table==='replay'?'json':'csv'}"`);
    if(table==='replay') return send(res,200,JSON.stringify(data,null,2));
    const rows=table==='matches'?data.matches:table==='telemetry'?data.telemetry:table==='exchanges'?data.records.filter(r=>r.kind==='exchange_completed').map(r=>({match_id:r.match_id,exchange:r.exchange_number,created_at:r.created_at,...r.payload})):data.records;
    return send(res,200,csv(rows),'text/csv');
  } catch { send(res,500,JSON.stringify({error:'Analysis load failed. Check Supabase credentials, network, and migration 004.'})); }
}).listen(port,'127.0.0.1',()=>console.log(`Wizard Duel analytics: http://127.0.0.1:${port}${demo?' (fixture data)':''}`));
