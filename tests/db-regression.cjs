const { PGlite } = require('@electric-sql/pglite');
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'), db=new PGlite();
const results=[];
const ok=(name)=>{results.push(name);console.log('ok '+name)};
const query=(sql)=>db.query(sql);
(async()=>{
 await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage; grant usage on schema auth to authenticated;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table public.cdf_members(email text primary key,name text,role text);
 insert into public.cdf_members values ('admin@test','Admin','admin'),('florist@test','Florist','vendor'),('driver@test','Driver','carrier'),('other@test','Other','carrier');
 create function public.cdf_my_role() returns text language sql stable security definer set search_path='' as $$select role from public.cdf_members where email=auth.jwt()->>'email'$$;
 create function public.cdf_is_admin() returns boolean language sql stable security definer set search_path='' as $$select public.cdf_my_role()='admin'$$;
 create function public.cdf_is_staff() returns boolean language sql stable security definer set search_path='' as $$select public.cdf_my_role()='admin'$$;
 create table public.cdf_orders(id uuid primary key,num text,date date,slot text,channel text,status text,delivery text,vendor_email text,customer_name text,buyer_name text,address text,customer_email text,customer_phone text,buyer_phone text,archived_at timestamptz,amount numeric(10,2),updated_at timestamptz,attempts integer default 0,missed_on date,missed_at timestamptz,delivery_note text,proof_path text);
 alter table public.cdf_orders add column photo_path text;
 insert into public.cdf_orders(id,num,date,slot,status,delivery,vendor_email,customer_name,buyer_name,buyer_phone,amount) values
 ('11111111-1111-1111-1111-111111111111','1',current_date,'10:00 - 12:00','Preparing','-','florist@test','Sofía Reyes','Buyer','+639171234567',12345),
 ('22222222-2222-2222-2222-222222222222','2',current_date,'12:00 - 14:00','Ready','-',null,'Ana','Buyer','09171234567',null);
 alter table public.cdf_orders enable row level security;
 grant select,insert,update,delete on public.cdf_orders to authenticated;
 create policy cdf_staff on public.cdf_orders for all to authenticated using(public.cdf_is_staff()) with check(public.cdf_is_staff());
 create policy cdf_vendor on public.cdf_orders for select to authenticated using(public.cdf_my_role()='vendor' and vendor_email=auth.jwt()->>'email');
 create policy cdf_orders_carrier_read on public.cdf_orders for select to authenticated using(public.cdf_my_role()='carrier' and status='Ready');
 create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;
 create policy cdf_fotos_carrier_read on storage.objects for select to authenticated using(false);
 create table public.cdf_order_events(id bigint generated always as identity primary key,order_id uuid references public.cdf_orders(id),at timestamptz default now(),by_email text,kind text,changes jsonb);
 alter table public.cdf_order_events enable row level security;grant select on public.cdf_order_events to authenticated;
 create policy events on public.cdf_order_events for select to authenticated using(public.cdf_is_staff());
 `);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/013_cdf_carrier_rules.sql'),'utf8'));ok('013 compiles in an isolated PostgreSQL database');
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261028012537_secure_prices_and_search.sql'),'utf8'));ok('Price, search and guard migration compiles');
 assert.equal((await query('select count(*)::integer n from public.cdf_orders')).rows[0].n,2);
 assert.equal((await query('select amount from public.cdf_order_prices')).rows[0].amount,'12345.00');
 assert((await query('select amount from public.cdf_orders')).rows.every(r=>r.amount===null));ok('All orders remain; existing price copied exactly and legacy field is empty');
 async function as(email){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email})]);await db.exec('set role authenticated')}
 await as('florist@test');assert.equal((await query('select * from public.cdf_order_prices')).rows.length,0);ok('Florist cannot read prices');
 let blocked=false;try{await query("insert into public.cdf_order_prices values('22222222-2222-2222-2222-222222222222',999)")}catch{blocked=true}assert(blocked);ok('Florist cannot create prices');
 // The old price column is closed even for the admin, who can write orders
 await as('admin@test');
 blocked=false;try{await query("update public.cdf_orders set amount=999 where num='2'")}catch{blocked=true}assert(blocked);ok('Legacy price writes are rejected');
 // Search and buyer history are office tools (admin)
 assert.equal((await query("select count(*)::int n from public.cdf_search_orders('Sofia')")).rows[0].n,1);ok('Server search matches accented names');
 const buyer=(await query("select * from public.cdf_buyer_history('639171234567',null)")).rows[0];assert.equal(Number(buyer.n),2);assert.equal(Number(buyer.total),12345);ok('Buyer history includes all orders and the admin sees their prices');
 await as('admin@test');await query("update public.cdf_order_prices set amount=5432.10 where order_id='11111111-1111-1111-1111-111111111111'");
 assert.equal((await query("select count(*)::int n from public.cdf_order_events where changes?'amount'")).rows[0].n,1);ok('Admin price changes produce history');
 await as('florist@test');assert.equal((await query("select count(*)::int n from public.cdf_order_events where changes?'amount'")).rows[0].n,0);ok('Price history is hidden from florists');
 await as('florist@test');blocked=false;try{await query("select public.cdf_progress('11111111-1111-1111-1111-111111111111','done')")}catch{blocked=true}assert(blocked);ok('Florist cannot skip Preparing to Delivered');
 await as('driver@test');await query("select public.cdf_progress('22222222-2222-2222-2222-222222222222','transit')");ok('Driver can take a ready order');
 await as('other@test');assert.equal((await query("select count(*)::int n from public.cdf_orders where num='2'")).rows[0].n,0);ok('Another driver cannot see the claimed order');
 blocked=false;try{await query("select public.cdf_progress('22222222-2222-2222-2222-222222222222','done')")}catch{blocked=true}assert(blocked);ok('Another driver cannot advance the claimed order');
 await db.exec('reset role');await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/015_cdf_member_stats.sql'),'utf8'));
 await query("update public.cdf_orders set delivery='Delivered' where num='1'");
 await as('admin@test');assert.equal((await query("select done_total::int n from public.cdf_member_stats() where email='florist@test'")).rows[0].n,1);ok('Admin sees each florist\'s completed orders');
 await as('florist@test');{const r=(await query("select email,done_total::int n from public.cdf_member_stats()")).rows;assert.equal(r.length,1);assert.equal(r[0].email,'florist@test');}ok('A florist only sees their own completed count');
 await as('driver@test');assert.equal((await query("select count(*)::int n from public.cdf_member_stats()")).rows[0].n,0);ok('A driver gets no florist stats');
 await db.exec('reset role');
 await db.exec(`create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','00000000-0000-0000-0000-000000000000')::uuid$$;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
  grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
  grant select on public.cdf_members to authenticated;`);
 await db.exec("update public.cdf_orders set delivery='-' where num='1'");
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/017_cdf_profiles_availability.sql'),'utf8'));ok('017 (profiles, availability, credit) compiles');
 // Florist marks ready, a driver delivers: each is credited once
 await as('florist@test');await query("select public.cdf_progress('11111111-1111-1111-1111-111111111111','ready')");
 await as('driver@test');await query("select public.cdf_progress('11111111-1111-1111-1111-111111111111','transit')");await query("select public.cdf_progress('11111111-1111-1111-1111-111111111111','done')");
 await db.exec('reset role');{const r=(await query("select prepared_by,delivered_by from public.cdf_orders where num='1'")).rows[0];assert.equal(r.prepared_by,'florist@test');assert.equal(r.delivered_by,'driver@test');}ok('Ready credits the florist, Delivered credits the driver');
 await as('admin@test');{const r=Object.fromEntries((await query("select email,done_total::int n from public.cdf_member_stats()")).rows.map(x=>[x.email,x.n]));assert.equal(r['florist@test'],1);assert.equal(r['driver@test'],1);assert.equal(r['admin@test'],0);}ok('Completed orders: one per order and person, nobody double counted');
 let forged=false;try{await query("update public.cdf_orders set prepared_by='admin@test' where num='1'");forged=(await query("select prepared_by from public.cdf_orders where num='1'")).rows[0].prepared_by==='admin@test'}catch{}assert(!forged);ok('Clients cannot rewrite who completed an order');
 // Availability: own or admin; dates checked; conflicts listed for the office
 await as('florist@test');await query("select public.cdf_set_availability('florist@test',current_date+1,current_date+3,'vacation')");
 blocked=false;try{await query("select public.cdf_set_availability('driver@test',current_date,null,null)")}catch{blocked=true}assert(blocked);ok('A florist sets their own absence but not someone else\'s');
 blocked=false;try{await query("select public.cdf_set_availability('florist@test',current_date+5,current_date+2,null)")}catch{blocked=true}assert(blocked);ok('An absence cannot end before it starts');
 await as('admin@test');await query("update public.cdf_orders set date=current_date+2, delivery='-', status='Preparing' where num='1'");
 assert.equal((await query("select count(*)::int n from public.cdf_away_conflicts()")).rows[0].n,1);ok('Pending orders inside an absence are listed for the admin');
 await as('florist@test');assert.equal((await query("select count(*)::int n from public.cdf_away_conflicts()")).rows[0].n,0);ok('Florists do not get the office conflict list');
 await as('admin@test');await query("select public.cdf_set_availability('florist@test',null,null,null)");assert.equal((await query("select count(*)::int n from public.cdf_away_conflicts()")).rows[0].n,0);ok('Admin can mark a florist available again');
 await as('florist@test');{const r=(await query("select * from public.cdf_save_profile('Flor',' +34 691 089 459 ',null)")).rows[0];assert.equal(r.name,'Flor');assert.equal(r.phone,'+34 691 089 459');assert.equal(r.role,'vendor');}ok('Own profile: name and phone saved, role untouched');
 blocked=false;try{await query("select public.cdf_save_profile('Flor','',  'someone-else/a.jpg')")}catch{blocked=true}assert(blocked);ok('A profile photo must be in the person\'s own folder');
 await db.exec('reset role');assert.equal((await query("select has_schema_privilege('authenticated','cdf_backup_20261028_integration','USAGE') allowed")).rows[0].allowed,false);ok('Price backup is not accessible to application roles');
 // 018: three roles only; the moderator role can no longer be given and the office is the admin
 await db.exec('reset role');await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/018_cdf_no_moderator.sql'),'utf8'));ok('018 (no moderator) compiles');
 blocked=false;try{await query("insert into public.cdf_members values('mod@test','Mod','moderator')")}catch{blocked=true}assert(blocked);ok('The moderator role can no longer be given');
 await as('admin@test');assert.equal((await query("select public.cdf_is_staff() s")).rows[0].s,true);assert((await query("select count(*)::int n from public.cdf_member_stats()")).rows[0].n>=2);ok('The admin is still the office and sees everyone');
 await as('florist@test');assert.equal((await query("select public.cdf_is_staff() s")).rows[0].s,false);ok('A florist is not office staff');
 fs.mkdirSync(path.join(root,'.impeccable/review'),{recursive:true});fs.writeFileSync(path.join(root,'.impeccable/review/sql-verification.json'),JSON.stringify({results,productionWrites:false},null,2));await db.close();
})().catch(async e=>{console.error(e.message);await db.close();process.exitCode=1});
