/**
 * Write a plugin folder's LICENSE (the editors' own MIT license) and
 * THIRD-PARTY-NOTICES.md (Buzz, DeepSeek libraries, web-clone workflow, fonts).
 *
 *   bin/node plugin-package/notices.mjs <plugin-folder> [...]
 */
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const read=path=>readFile(join(root,path),'utf8');

export async function writeNotices(output){
 await writeFile(join(output,'LICENSE'),await read('portable/COPYOS-LICENSE'));
 const parts=[
  ['Buzz app (Block, Inc.)','Parts of the Buzz app are bundled into this plugin. Apache License 2.0.','LICENSE'],
  ['Buzz app NOTICE','Required notice from the Buzz app.','NOTICE.md'],
  ['DeepSeek Harness libraries (dsh-*)','Seven helper libraries from DeepSeek Harness. MIT.','portable/libraries/dsh-atomic-write/LICENSE'],
  ['OpenDesign Web Clone workflow','Page Builder\'s website cloning is adapted from the `skills/web-clone` workflow of [OpenDesign](https://github.com/nexu-io/open-design) (commit `1b47e60`), by jane (xiaoer). Thanks to the OpenDesign project. The workflow is MIT; OpenDesign itself is Apache 2.0.','portable/page-workflows/copyos-web-clone/LICENSE'],
  ['Inter font','SIL Open Font License 1.1.','portable/copyos-domain/fonts/OFL.txt'],
  ['Noto font','SIL Open Font License 1.1.','portable/copyos-domain/fonts/Noto-OFL.txt'],
 ];
 let text='# Third-party notices\n\nThis plugin is MIT licensed by Lucas Mondora (see LICENSE). It also includes the following, under their own licenses. Other open-source packages in the bundled runtime keep their license files inside the downloaded runtime (`editor-host.tgz`).\n';
 for(const [name,about,path]of parts)text+=`\n## ${name}\n\n${about}\n\n\`\`\`text\n${(await read(path)).trim()}\n\`\`\`\n`;
 await writeFile(join(output,'THIRD-PARTY-NOTICES.md'),text);
}

if(process.argv[1]===fileURLToPath(import.meta.url))
 for(const folder of process.argv.slice(2))await writeNotices(resolve(folder));
