const fs = require('fs');
const p = 'app/(tabs)/courses.tsx';
let c = fs.readFileSync(p, 'utf-8');

const oldPoll = [
"        if (status === 'completed' || status === 'succeeded') {",
'          if (pollRef.current) clearInterval(pollRef.current);',
"          setJob(prev => ({",
'            ...prev,',
"            status: 'completed',",
'            progress: 100,',
"            step: '课堂生成完成',",
'            classroomId,',
'          }));',
'          await loadClassrooms();',
"        } else if (status === 'failed' || status === 'error') {",
'          if (pollRef.current) clearInterval(pollRef.current);',
"          setJob(prev => ({",
'            ...prev,',
"            status: 'failed',",
"            error: formatCourseError(data.error_message || '课堂生成失败'),",
'          }));',
'        } else {',
"          setJob(prev => ({",
'            ...prev,',
"            status: status === 'queued' ? 'queued' : 'running',",
'            progress,',
'            step,',
'            classroomId: classroomId || prev.classroomId,',
'          }));',
'        }',
].join('\n');

const newPoll = [
'        // Progressive: navigate to classroom as soon as we have a classroomId,',
'        // even if the job is still generating remaining scenes.',
'        if (classroomId) {',
'          if (pollRef.current) clearInterval(pollRef.current);',
'          setJob(prev => ({',
'            ...prev,',
"            status: 'completed',",
'            progress: 100,',
"            step: '课堂已生成',",
'            classroomId,',
'          }));',
'          await loadClassrooms();',
"        } else if (status === 'failed' || status === 'error') {",
'          if (pollRef.current) clearInterval(pollRef.current);',
"          setJob(prev => ({",
'            ...prev,',
"            status: 'failed',",
"            error: formatCourseError(data.error_message || '课堂生成失败'),",
'          }));",
'        } else {',
"          setJob(prev => ({",
'            ...prev,',
"            status: status === 'queued' ? 'queued' : 'running',",
'            progress,',
'            step,',
'            classroomId: classroomId || prev.classroomId,',
'          }));',
'        }',
].join('\n');

c = c.replace(oldPoll, newPoll);
fs.writeFileSync(p, c);
console.log('ok');
