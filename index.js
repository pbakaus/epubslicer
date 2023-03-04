"use strict";
import AdmZip from "adm-zip";
import EpubSlicer from "./slicer.js";

const args = process.argv.slice(2);
const input = args[0];
const output = args[1];

if(!input || !output) {
    throw new Error('Please provide both an input file in the first argument, and an output file in the second.');
}

const options = {
   // this of course needs to come from the preview chapter selection UI, dynamically
    keepChapters: [
        'cover',
        'titlepage',
        'brief-toc',
        'xpreface_001',
        'xintroduction_001',
        'xepigraph_001',
        'xchapter_001',
        'xchapter_002'
    ]
}

// reading archives
const zip = new AdmZip(input);
const OPF = EpubSlicer.getOPF(zip);

// delete chapters from spine first - returns deleted chapters as array
EpubSlicer.deleteChaptersFromSpine(OPF, options.keepChapters);

// delete all other references to the deleted chapters
EpubSlicer.cleanup(zip, OPF);

// Re-serialize OPF to string and save back into zip
EpubSlicer.saveOPF(zip, OPF);

// save new file
zip.writeZip(output);
console.log('wrote new stripped epub to ' + output);