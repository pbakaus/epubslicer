import path from 'path';
import X2JS from 'x2js';
const x2js = new X2JS();

const _data = {
    rootfile: null,
    deletedIds: [],
    deletedEntries: [],
};

const Slicer = {
    getXML: (zipObj, path) => {
        const container = zipObj.getEntry(path);
        const xmlContent = container.getData().toString("utf8");
        return x2js.xml2js(xmlContent);
    },
    saveXML: (zipObj, entryUrl, xmlDoc) => {
        const str = '<?xml version="1.0" encoding="UTF-8"?>' + x2js.js2xml(xmlDoc);
        return zipObj.updateFile(entryUrl, Buffer.from(str));
    },
    getOPF: function(zipObj) {
        _data.rootfile = _data.rootfile || Slicer.getXML(zipObj, 'META-INF/container.xml').container.rootfiles.rootfile['_full-path'];
        return Slicer.getXML(zipObj, _data.rootfile);
    },
    saveOPF: function(zipObj, xmlDoc) {
        return Slicer.saveXML(zipObj, _data.rootfile, xmlDoc);
    },
    deleteChaptersFromSpine: (OPF, chaptersToKeep) => {
        OPF.package.spine.itemref = OPF.package.spine.itemref.filter(chapter => {
            let chapterId = chapter._idref;
            if(chaptersToKeep.includes(chapterId)) {
                return true;
            }

            _data.deletedIds.push(chapterId);
            return false;
        });
        return _data.deletedIds;
    },
    deleteChaptersFromEntry(zipObj, entryUrl) {
        const xmlDoc = Slicer.getXML(zipObj, entryUrl);

        const iterate = (obj, srcKey, srcObj) => {
            Object.keys(obj).every(key => {
                // if the XML node has a property 'id' that matches a to-be-deleted chapter id, wipe it
                if(key === '_id' && _data.deletedIds.includes(obj[key])) {
                    delete srcObj[srcKey];
                    return false;
                }

                // if the XML node has a property 'href' that matches a to-be-deleted chapter url, also wipe it
                if(key === '_href' && _data.deletedEntries.includes(obj[key])) {
                    delete srcObj[srcKey];
                    return false;
                }

                if (typeof obj[key] === "object") {
                    iterate(obj[key], key, obj);
                }
                return true;
            })
        }

        iterate(xmlDoc);
        return Slicer.saveXML(zipObj, entryUrl, xmlDoc);

    },
    cleanup(zipObj, OPF) {

        var regToc = null;
        var ncxToc = null;

        // remove from OPF manifest (but don't wipe the nav - important)
        OPF.package.manifest.item = OPF.package.manifest.item.filter(chapter => {
            const absPath = path.join(path.dirname(_data.rootfile), chapter._href);

            // if the item matches a to-be-deleted id, wipe it, and keep track of the related file url
            // so we can scan other files later to delete anything referring to that url.
            // IMPORTANT: We need to make sure to not wipe the TOCs (this would make the EPUB invalid)
            if(_data.deletedIds.includes(chapter._id) && chapter._properties !== 'nav' && chapter['_media-type'] !== 'application/x-dtbncx+xml') {
                _data.deletedEntries.push(chapter._href); // important: needs to be the relative path, not abs path
                zipObj.deleteFile(absPath); // delete actual chapter file
                return false;
            }
            
            return true;
        });

        // remove from TOCs (retrieve them from the manifest node)
        OPF.package.manifest.item.forEach(chapter => {

            const absPath = path.join(path.dirname(_data.rootfile), chapter._href);

            // delete leftovers in the main TOC
            if(chapter._properties === 'nav') {
                Slicer.deleteChaptersFromEntry(zipObj, absPath);
            }

            // delete leftovers in the NCX TOC
            if(chapter['_media-type'] === 'application/x-dtbncx+xml') {
                Slicer.deleteChaptersFromEntry(zipObj, absPath);
            }

        });

        // TODO: optionally more thoroughly scan all other files and delete all links to the deleted chapters

    }
}

Object.freeze(Slicer);
export default Slicer;