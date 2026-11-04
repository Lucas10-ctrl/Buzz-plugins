/**
 * Runtime entry the plugin launchers start after downloading and verifying the runtime.
 *   launch.mjs ui <ui-bundle.mjs.gz>   print the editor UI bundle as base64
 *   launch.mjs repository <data-root>  run the editor repository worker
 */
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [mode,target]=process.argv.slice(2);
if(!target)throw new Error('usage: launch.mjs ui|repository <path>');
if(mode==='ui')process.stdout.write(readFileSync(target).toString('base64'));
else if(mode==='repository'){
 const {start}=await import(pathToFileURL(join(dirname(process.execPath),'editor-bootstrap.mjs')).href);
 await start(target);
}else throw new Error(`Unknown launch mode: ${mode}`);
