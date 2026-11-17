const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('docs/app.js','utf8');
const start=source.indexOf('const formatAmount='),end=source.indexOf('function bindAmountInputs');
const {formatAmount,parseAmount}=vm.runInNewContext(source.slice(start,end)+';({formatAmount,parseAmount})');
test('amounts use dots and round-trip without changing stored value',()=>{for(const [n,text] of [[0,'0'],[1000,'1.000'],[1250000,'1.250.000'],[999999999,'999.999.999']]){assert.equal(formatAmount(n),text);assert.equal(parseAmount(text),n)}});
test('invalid and fractional amounts are rejected',()=>{for(const value of ['', '1,50','1.5','abc','-100'])assert.ok(Number.isNaN(parseAmount(value)));assert.equal(parseAmount('1250000'),1250000)});
