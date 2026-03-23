import * as vscode from 'vscode';

// Global array to track and clear highlights between runs
let activeDecorations: vscode.TextEditorDecorationType[] = [];

export function activate(context: vscode.ExtensionContext) {
    console.log('AlgoX Time Complexity Analyzer is now active!');

    let disposable = vscode.commands.registerCommand('algox-complexity-analyzer.analyze', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Please open a Python or Java file first.');
            return;
        }

        const text = editor.document.getText();
        const language = editor.document.languageId;

        // Clear previous highlights
        activeDecorations.forEach(d => d.dispose());
        activeDecorations = [];

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "AlgoX: Analyzing Time Complexity...",
            cancellable: false
        }, async (progress) => {
            try {
                // Clean the code and generate the map
                const { cleanedCode, offsetMap } = cleanCodeAndMap(text, language);

                // Send the CLEANED code to the API
                const apiUrl = 'https://himansha2001-algox-backend.hf.space/predict'; 
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: cleanedCode, language: language })
                });

                if (!response.ok) throw new Error('API request failed');
                const data = await response.json();
                
                vscode.window.showInformationMessage(
                    `AlgoX Prediction: ${data.complexity} (Confidence: ${(data.confidence * 100).toFixed(2)}%)`
                );

                data.shap_explanation.forEach((item: any) => {
                    const isWhitespaceOnly = item.token.replace(/Ġ/g, ' ').replace(/Ċ/g, '\n').trim() === '';
                    if (isWhitespaceOnly || (item.start_char === 0 && item.end_char === 0)) return;

                    // TRANSLATE COORDINATES
                    // Ensure the token indices are within the bounds
                    if (item.start_char >= offsetMap.length) return;
                    
                    const originalStart = offsetMap[item.start_char];
                    // end_char is exclusive, so map the last included char and add 1
                    const originalEndIndex = Math.min(item.end_char - 1, offsetMap.length - 1);
                    const originalEnd = offsetMap[originalEndIndex] + 1;

                    const startPos = editor.document.positionAt(originalStart);
                    const endPos = editor.document.positionAt(originalEnd);
                    const range = new vscode.Range(startPos, endPos);

                    let backgroundColor = '';
                    if (item.score > 0) {
                        const alpha = Math.min(item.score * 50, 0.9);
                        backgroundColor = `rgba(220, 38, 38, ${alpha})`;
                    } else if (item.score < 0) {
                        const alpha = Math.min(Math.abs(item.score) * 50, 0.5);
                        backgroundColor = `rgba(37, 99, 235, ${alpha})`;
                    }

                    if (backgroundColor) {
                        const decorationType = vscode.window.createTextEditorDecorationType({
                            backgroundColor: backgroundColor,
                            borderRadius: '2px'
                        });
                        
                        activeDecorations.push(decorationType);
                        
                        editor.setDecorations(decorationType, [{
                            range: range,
                            hoverMessage: `SHAP Impact: ${item.score.toFixed(4)}`
                        }]);
                    }
                });

            } catch (error) {
                vscode.window.showErrorMessage('AlgoX API Error: Make sure your backend is running!');
                console.error(error);
            }
        });
    });

	let clearDisposable = vscode.commands.registerCommand('algox-complexity-analyzer.clear', () => {
        // Dispose of all active colors
        activeDecorations.forEach(d => d.dispose());
        activeDecorations = [];
        vscode.window.showInformationMessage('AlgoX: Highlights cleared.');
    });

    context.subscriptions.push(disposable);
	context.subscriptions.push(clearDisposable);
}

export function deactivate() {
    activeDecorations.forEach(d => d.dispose());
}

function cleanCodeAndMap(original: string, lang: string) {
    // Start with a 1:1 map where map[current_index] = original_index
    let map = Array.from({length: original.length}, (_, i) => i);
    let current = original;

    function applyRegex(regex: RegExp, replaceWith: string) {
        let match;
        let matches = [];
        // Find all matches
        while ((match = regex.exec(current)) !== null) {
            if (match[0].length === 0) break; 
            matches.push({ index: match.index, length: match[0].length });
        }
        
        // Replace from back to front
        for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i];
            current = current.slice(0, m.index) + replaceWith + current.slice(m.index + m.length);
            
            // Update the coordinate map
            const replacementMap = replaceWith === '' ? [] : [map[m.index]];
            map.splice(m.index, m.length, ...replacementMap);
        }
    }

    if (lang === 'java') {
        applyRegex(/\/\*[\s\S]*?\*\//g, ''); // Remove block comments
        applyRegex(/\/\/.*/g, '');           // Remove line comments
    }
    applyRegex(/\n\s*\n/g, '\n');            // Remove double newlines

    // Mimic Python's .strip()
    let start = 0;
    while (start < current.length && current[start].trim() === '') start++;
    let end = current.length - 1;
    while (end >= 0 && current[end].trim() === '') end--;

    current = current.slice(start, end + 1);
    map = map.slice(start, end + 1);

    return { cleanedCode: current, offsetMap: map };
}