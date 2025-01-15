const express = require('express');
const { exec } = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const archiver = require('archiver');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 5000;

// Configuração básica do CORS
app.use(cors());
app.use(express.json());

// Função para sanitizar o nome do arquivo
const sanitizeFileName = (name) => {
    return name.replace(/[<>:"/\\|?*]+/g, '').trim();
};

// Função para obter vídeos da playlist (ignora privados)
const getPlaylistVideos = async (playlistId, apiKey) => {
    let videos = [];
    let nextPageToken = '';
    do {
        const response = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
            params: {
                part: 'snippet,status',
                playlistId,
                maxResults: 50,
                pageToken: nextPageToken,
                key: apiKey,
            },
        });

        const items = response.data.items;
        items.forEach(item => {
            const videoId = item.snippet.resourceId.videoId;
            const title = item.snippet.title;
            const privacyStatus = item.status.privacyStatus;

            // Ignorar vídeos privados ou não listados
            if (privacyStatus !== 'private') {
                videos.push({ videoId, title });
            }
        });

        nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    return videos;
};

// Função para converter o vídeo para MP3 com logs adicionais
const convertToMP3 = async (videoName, videoUrl, outputDir) => {
    const sanitizedVideoName = sanitizeFileName(videoName); // Sanitizar o nome do vídeo
    const outputPath = path.join(outputDir, `${sanitizedVideoName}.mp3`);

    console.log("🚀 ~ Converting:", sanitizedVideoName);
    console.log(`Arquivo de saída: ${outputPath}`);

    return new Promise((resolve, reject) => {
        exec(videoUrl, {
            output: outputPath,
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: '128K',
        })
            .then(() => {
                console.log(`Vídeo convertido com sucesso: ${outputPath}`);
                resolve(outputPath);
            })
            .catch((err) => {
                console.error(`Erro ao converter "${videoName}":`, err.message);
                reject(err);
            });
    });
};

const createZip = (outputDir, files, zipFilePath) => {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 }, // Nível de compactação
        });

        output.on('close', () => {
            console.log(`Arquivo ZIP criado com sucesso: ${zipFilePath}, tamanho: ${archive.pointer()} bytes`);
            resolve(zipFilePath);
        });

        archive.on('error', (err) => {
            console.error('Erro ao criar o arquivo ZIP:', err);
            reject(err);
        });

        archive.pipe(output);

        // Antes de adicionar ao ZIP, verificar o conteúdo do diretório temporário
        console.log("Arquivos no diretório temporário:");
        const filesInDir = fs.readdirSync(outputDir);
        console.log(filesInDir);

        // Adiciona os arquivos MP3 ao ZIP
        files.forEach(file => {
            const filePath = path.join(outputDir, file);
            if (fs.existsSync(filePath)) {
                console.log(`Adicionando ao ZIP: ${filePath}`);
                archive.file(filePath, { name: file });
            } else {
                console.warn(`Arquivo não encontrado para o ZIP: ${filePath}`);
            }
        });

        archive.finalize();
    });
};

// Função para remover diretório de forma segura
const removeDirectory = async (dirPath) => {
    try {
        // Tentar remover o diretório
        await fs.promises.rm(dirPath, { recursive: true, force: true });
        console.log(`Diretório removido com sucesso: ${dirPath}`);
    } catch (err) {
        console.error(`Erro ao remover o diretório ${dirPath}:`, err);
        throw err;
    }
};

// Endpoint atualizado com logs detalhados
app.post('/convert-playlist', async (req, res) => {
    const { playlistUrls, apiKey } = req.body;

    if (!playlistUrls || playlistUrls.length === 0 || !apiKey) {
        return res.status(400).send({ error: 'URLs da playlist ou API Key não fornecidos.' });
    }

    // Diretório temporário para salvar os arquivos
    const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'playlist-'));

    try {
        let allVideos = [];
        for (let playlistUrl of playlistUrls) {
            const playlistId = new URL(playlistUrl).searchParams.get('list');
            if (!playlistId) {
                return res.status(400).send({ error: 'URL inválida para a playlist.' });
            }

            const videos = await getPlaylistVideos(playlistId, apiKey);

            for (let video of videos) {
                try {
                    const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
                    const filePath = await convertToMP3(video.title, videoUrl, tempDir);
                    console.log(`Vídeo convertido com sucesso: ${filePath}`);
                    allVideos.push(path.basename(filePath)); // Apenas o nome do arquivo
                } catch (error) {
                    console.error(`Erro ao processar vídeo "${video.title}":`, error.message);
                }
            }
        }

        if (allVideos.length === 0) {
            return res.status(500).send({ error: 'Nenhum vídeo foi convertido com sucesso.' });
        }

        // Criar o arquivo ZIP
        const zipFilePath = path.join(tempDir, 'playlist_files.zip');
        await createZip(tempDir, allVideos, zipFilePath);

        // Enviar o arquivo ZIP para o cliente
        res.download(zipFilePath, 'playlist_files.zip', async (err) => {
            if (err) {
                console.error('Erro ao enviar o arquivo:', err);
                res.status(500).send({ error: 'Erro ao enviar o arquivo.' });
            } else {
                // Após o download, exclua o diretório temporário
                await removeDirectory(tempDir);
            }
        });
    } catch (error) {
        console.error('Erro ao processar playlist:', error);
        res.status(500).send({ error: 'Erro ao processar playlist.' });
    }
});

// Iniciar o servidor
app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
