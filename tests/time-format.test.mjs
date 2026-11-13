import fs from "node:fs";import vm from "node:vm";import assert from "node:assert/strict";
import {formatSlot12 as serverSlot} from "../supabase/functions/_shared/time.ts";
const src=fs.readFileSync(new URL("../i18n.js",import.meta.url),"utf8");
const ctx={Intl,Date};vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf("function formatSlot12"),src.indexOf("const I18N =")),ctx);
const examples={"00:00":"12:00 AM","08:00":"8:00 AM","12:00":"12:00 PM","13:30":"1:30 PM","20:00":"8:00 PM","23:59":"11:59 PM","24:00":"12:00 AM","08:00 - 20:30":"8:00 AM - 8:30 PM","23:00 - 24:00":"11:00 PM - 12:00 AM","25:00":"25:00","24:30":"24:30"};
for(const [value,expected]of Object.entries(examples)){assert.equal(ctx.formatSlot12(value),expected);assert.equal(serverSlot(value),expected);}
for(let i=0;i<1440;i++){const value=String(Math.floor(i/60)).padStart(2,"0")+":"+String(i%60).padStart(2,"0");assert.equal(ctx.formatSlot12(value),serverSlot(value));}
assert.equal(ctx.formatClock12("2026-11-12T16:00:00Z"),"12:00 AM");assert.equal(ctx.formatClock12("2026-11-13T04:00:00Z"),"12:00 PM");assert.equal(ctx.formatClock12("2026-11-13T12:30:00Z"),"8:30 PM");
assert.match(ctx.formatDateTime12("2026-11-13T12:30:00Z","es"),/8:30 PM$/);assert.match(ctx.formatDateTime12("2026-11-13T12:30:00Z","en"),/8:30 PM$/);
assert.equal(ctx.formatSlot12(null),"");console.log("ok all 1440 minutes, midnight/noon, minute precision, overnight ranges, Spanish/English and Manila time; frontend and notifications agree");

