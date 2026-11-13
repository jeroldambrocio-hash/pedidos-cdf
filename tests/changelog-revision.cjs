const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(require('path').join(__dirname,'../js/changelog.js'),'utf8');
let seen='2026-11-13';const context={pref:()=>seen};vm.createContext(context);
vm.runInContext(source.slice(0,source.indexOf('function paintChangelogDot'))+';this.audit={CHANGELOG,changelogRevision,changelogUnseen}',context);
const a=context.audit;assert.equal(a.changelogUnseen(),true);seen=a.changelogRevision();assert.equal(a.changelogUnseen(),false);
a.CHANGELOG[0].en.push('Another update on the same date');assert.equal(a.changelogUnseen(),true);seen=a.changelogRevision();assert.equal(a.changelogUnseen(),false);
a.CHANGELOG[0].es.push('Otra actualización el mismo día');assert.equal(a.changelogUnseen(),true);a.CHANGELOG.length=0;assert.equal(a.changelogUnseen(),false);
console.log('ok release-note changes on the same day show the dot; seen notes and an empty log do not');

