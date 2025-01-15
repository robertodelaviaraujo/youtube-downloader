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

// Função para converter o vídeo para MP3
const convertToMP3 = async (videoName, videoUrl, outputDir) => {
    const sanitizedVideoName = sanitizeFileName(videoName); // Sanitizar o nome do vídeo
    const outputPath = path.join(outputDir, `${sanitizedVideoName}.mp3`);

    console.log("🚀 ~ Converting :", sanitizedVideoName)

    return new Promise((resolve, reject) => {
        exec(videoUrl, {
            output: outputPath,
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: '128K',
        })
            .then(() => resolve(outputPath))
            .catch((err) => reject(err));
    });
};

// Função para gerar o arquivo ZIP
const createZip = (outputDir, files, zipFilePath) => {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 }, // Nível de compactação
        });

        output.on('close', () => resolve(zipFilePath));
        archive.on('error', (err) => reject(err));

        archive.pipe(output);

        // Adiciona os arquivos MP3 ao ZIP
        files.forEach(file => {
            archive.file(path.join(outputDir, file), { name: file });
        });

        archive.finalize();
    });
};

// Endpoint para converter playlist
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
            // Extrair o ID da playlist da URL
            const playlistId = new URL(playlistUrl).searchParams.get('list');
            if (!playlistId) {
                return res.status(400).send({ error: 'URL inválida para a playlist.' });
            }

            const videos = await getPlaylistVideos(playlistId, apiKey);

            for (let video of videos) {
                try {
                    const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
                    await convertToMP3(video.title, videoUrl, tempDir);
                    allVideos.push(`${sanitizeFileName(video.title)}.mp3`);
                } catch (error) {
                    console.error(`Erro ao processar vídeo "${video.title}":`, error.message);
                }
            }
        }

        // Criar o arquivo ZIP
        const zipFilePath = path.join(tempDir, 'playlist_files.zip');
        await createZip(tempDir, allVideos, zipFilePath);

        // Enviar o arquivo ZIP para o cliente
        res.download(zipFilePath, 'playlist_files.zip', (err) => {
            if (err) {
                console.error('Erro ao enviar o arquivo:', err);
                res.status(500).send({ error: 'Erro ao enviar o arquivo.' });
            } else {
                // Após o download, exclua o diretório temporário
                fs.rmSync(tempDir, { recursive: true, force: true });
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
