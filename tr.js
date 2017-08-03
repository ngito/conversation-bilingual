// ----------------------------------------------------------------------------
// Sample code using Google Translate API
// ----------------------------------------------------------------------------

require( 'dotenv' ).config( {silent: true} );

var translateApiKey = process.env.TRANSLATE_API_KEY
var googleTranslate = require('google-translate')(translateApiKey);
var languageTo = "en";

process.stdout.write("Enter any text to be translated to " + languageTo + ", Ctrl-C to exit\n");
process.stdin.pipe(require('split')()).on('data', processLine)

function processLine (line) {
  googleTranslate.translate(line, languageTo, function(err, translation) {
//   console.log(translation.translatedText);
    console.log(translation);
});
}

