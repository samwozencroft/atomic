const os = require('os');
const totalMem = os.totalmem();
const freeMem = os.freemem();
console.log('Mem:', Math.round(((totalMem - freeMem) / totalMem) * 100));

let previousCpuInfo = os.cpus();
setTimeout(() => {
    const currentCpuInfo = os.cpus();
    let idleDiff = 0;
    let totalDiff = 0;
    for (let i = 0; i < currentCpuInfo.length; i++) {
        const cpu = currentCpuInfo[i];
        const prevCpu = previousCpuInfo[i];
        const prevTotal = Object.values(prevCpu.times).reduce((a, b) => a + b, 0);
        const currTotal = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        idleDiff += cpu.times.idle - prevCpu.times.idle;
        totalDiff += currTotal - prevTotal;
    }
    const cpuPercent = totalDiff === 0 ? 0 : Math.round(100 - (100 * idleDiff / totalDiff));
    console.log('CPU:', cpuPercent);
}, 1000);
