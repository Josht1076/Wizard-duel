import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {completedSolo} from './solo-fixture';
import {restore,type SavedGame} from '../src/lib/solo/archive';
import {load,save,upload} from '../src/lib/solo/storage';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../src/lib/supabase/server',()=>({createServerSupabaseClient:()=>({rpc})}));
import {POST} from '../src/app/api/solo/complete/route';
const request=(body:unknown)=>new Request('http://localhost/api/solo/complete',{method:'POST',body:JSON.stringify(body)});
const token='private-upload-token-aaaaaaaaaaaaaaaa';
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:{status:'saved'},error:null});});
afterEach(()=>vi.unstubAllGlobals());
describe('solo completion API',()=>{
 it('derives persisted winner and state from legal moves, ignoring submitted results',async()=>{
   const archive=completedSolo();const response=await POST(request({archive,uploadToken:token,winner:'forged',health:999}));
   expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledOnce();
   expect(rpc.mock.calls[0][0]).toBe('wd_save_solo');
   expect(rpc.mock.calls[0][1].p_data.winner).toBe(restore(archive).winner);
   expect(rpc.mock.calls[0][1].p_data.players[0].health).not.toBe(999);
 });
 it('rejects unfinished, tampered, oversized, and invalid-token games before storage',async()=>{
   const archive=completedSolo();
   expect((await POST(request({archive:{...archive,actions:[]},uploadToken:token}))).status).toBe(400);
   expect((await POST(request({archive,uploadToken:'bad'}))).status).toBe(400);
   const illegal=structuredClone(archive);illegal.actions[0].move={kind:'defend',seat:'A',spell:'Full',power:5,boost:false};
   expect((await POST(request({archive:illegal,uploadToken:token}))).status).toBe(400);
   expect((await POST(new Request('http://localhost/api/solo/complete',{method:'POST',body:' '.repeat(1048577)}))).status).toBe(413);
   expect(rpc).not.toHaveBeenCalled();
 });
 it('returns retryable storage failures and successful duplicate acknowledgements',async()=>{
   const body={archive:completedSolo(),uploadToken:token};rpc.mockResolvedValueOnce({data:null,error:{message:'offline'}});
   expect((await POST(request(body))).status).toBe(503);
   rpc.mockResolvedValueOnce({data:{status:'already_saved'},error:null});expect(await (await POST(request(body))).json()).toEqual({status:'already_saved'});
 });
});
describe('local completion outbox',()=>{
 it('retains the history and upload token after failure, then marks confirmed uploads saved',async()=>{
   const data=new Map<string,string>();
   vi.stubGlobal('window',{localStorage:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)}});
   const game:SavedGame={archive:completedSolo(),uploadToken:token,uploaded:false};save(game);
   const fetch=vi.fn().mockResolvedValueOnce(Response.json({error:'offline'},{status:503})).mockResolvedValueOnce(Response.json({status:'already_saved'}));vi.stubGlobal('fetch',fetch);
   await expect(upload(game)).rejects.toThrow('Upload failed');expect(load()?.uploaded).toBe(false);expect(load()?.uploadToken).toBe(token);
   await upload(game);expect(load()?.uploaded).toBe(true);expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
 });
 it('reports server success even when local acknowledgement storage is full',async()=>{
   vi.stubGlobal('window',{localStorage:{setItem:()=>{throw new Error('quota');}}});
   vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({status:'saved'})));
   const result=await upload({archive:completedSolo(),uploadToken:token,uploaded:false});expect(result?.uploaded).toBe(true);
 });

});
