"use strict";

const path = require('node:path')
const X2JS = require("x2js");
const x2js = new X2JS();
const AdmZip = require("adm-zip");

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

const utils = {
    _rootfile: null,
    _deletedIds: [],
    _deletedEntries: [],
    getXML: function(zipObj, path) {
        const container = zipObj.getEntry(path);
        const xmlContent = container.getData().toString("utf8");
        return x2js.xml2js(xmlContent);
    },
    saveXML: function(zipObj, entryUrl, xmlDoc) {
        const str = '<?xml version="1.0" encoding="UTF-8"?>' + x2js.js2xml(xmlDoc);
        return zipObj.updateFile(entryUrl, Buffer.from(str));
    },
    getOPF: function(zipObj) {
        utils._rootfile = utils._rootfile || utils.getXML(zipObj, 'META-INF/container.xml').container.rootfiles.rootfile['_full-path'];
        return utils.getXML(zipObj, utils._rootfile);
    },
    saveOPF: function(zipObj, xmlDoc) {
        return utils.saveXML(zipObj, utils._rootfile, xmlDoc);
    },
    deleteChaptersFromSpine(OPF) {
        OPF.package.spine.itemref = OPF.package.spine.itemref.filter(chapter => {
            let chapterId = chapter._idref;
            if(options.keepChapters.includes(chapterId)) {
                return true;
            } else {
                utils._deletedIds.push(chapterId);
                return false;
            }
        });
        return utils._deletedIds;
    },
    deleteChaptersFromEntry(zipObj, entryUrl) {
        const xmlDoc = utils.getXML(zipObj, entryUrl);

        const iterate = (obj, srcKey, srcObj) => {
            Object.keys(obj).every(key => {

                // if the XML node has a property 'id' that matches a to-be-deleted chapter id, wipe it
                if(key === '_id' && utils._deletedIds.includes(obj[key])) {
                    return delete srcObj[srcKey];
                }


                // if the XML node has a property 'href' that matches a to-be-deleted chapter url, also wipe it
                if(key === '_href' && utils._deletedEntries.includes(obj[key])) {
                    return delete srcObj[srcKey];
                }

                if (typeof obj[key] === "object") {
                    iterate(obj[key], key, obj);
                }
                return true;
            })
        }

        if(!xmlDoc.html) return;
        iterate(xmlDoc);

        return utils.saveXML(zipObj, entryUrl, xmlDoc);

    },
    cleanup(zipObj, OPF) {

        var regToc = null;
        var ncxToc = null;

        // remove from OPF manifest (but don't wipe the nav - important)
        OPF.package.manifest.item = OPF.package.manifest.item.filter(chapter => {

            // if the item matches a to-be-deleted id, wipe it, and keep track of the related file url
            // so we can scan other files later to delete anything referring to that url.
            // IMPORTANT: We need to make sure to not wipe the TOCs (this would make the EPUB invalid)
            if(utils._deletedIds.includes(chapter._id) && chapter._properties !== 'nav' && chapter['_media-type'] !== 'application/x-dtbncx+xml') {
                utils._deletedEntries.push(chapter._href); // important: needs to be the relative path, not abs path
                return false;
            }
            
            return true;
        });

        // remove from TOCs (retrieve them from the manifest node)
        OPF.package.manifest.item.forEach(chapter => {

            const absPath = path.join(path.dirname(utils._rootfile), chapter._href);

            // delete leftovers in the main TOC
            if(chapter._properties === 'nav') {
                utils.deleteChaptersFromEntry(zipObj, absPath);
            }

            // delete leftovers in the NCX TOC
            if(chapter['_media-type'] === 'application/x-dtbncx+xml') {
                utils.deleteChaptersFromEntry(zipObj, absPath);
            }

        });

        // TODO: optionally more thoroughly scan all other files and delete all links to the deleted chapters

    }
};

// reading archives
var zip = new AdmZip(input);
var OPF = utils.getOPF(zip);

// delete chapters from spine first - returns deleted chapters as array
utils.deleteChaptersFromSpine(OPF);

// delete all other references to the deleted chapters
utils.cleanup(zip, OPF);

// Re-serialize OPF to string and save back into zip
utils.saveOPF(zip, OPF);

// save new file
zip.writeZip(output);
console.log('wrote new stripped epub to ' + output);
