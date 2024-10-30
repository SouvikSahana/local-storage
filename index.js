const express= require("express")
const fs= require('fs')
const path= require("path")
const {MongoClient, GridFSBucket, ObjectId}= require("mongodb")
const multer= require('multer')
const {v4}= require('uuid')
const {Readable}= require('stream')
const cors= require('cors')
const ffmpeg = require('fluent-ffmpeg');
const deasync = require('deasync');
require('dotenv').config()

const app=express()
const port=process.env.PORT || 5000
app.use(express.static(path.join(__dirname,"/image")))
app.use(cors('*'))
const uri= process.env.MONGO_URI || "mongodb://localhost:27017/mydb?retryWrites=true&w=majority"


const upload= multer({})

const generateThumbnail = (videoBuffer) => {
    return new Promise((resolve, reject) => {
        const base64Image = [];
        const readStream= new Readable() //stream can be used only once
                    readStream.push(videoBuffer)
                    readStream.push(null)
        ffmpeg(readStream)
            .outputOptions('-f image2pipe') // Use image2pipe for output
            .outputOptions('-vframes 1') // Specify to capture one frame
            .outputOptions('-vcodec png') // Use PNG codec
            .seek('0:05')
            .on('error', function(err) {
                console.log('An error occurred: ' + err.message);
                reject(err.message);
            })
            .on('end', function() {
                console.log('Processing finished!');
                const base64String = Buffer.concat(base64Image).toString('base64');
                resolve(`data:image/png;base64,${base64String}`);
            })
            .pipe(Readable.from(base64Image), { end: true }) // Pipe output to base64Image
            .on('data', (chunk) => {
                base64Image.push(chunk); // Collect chunks of data
            });
    });
};



MongoClient.connect(uri, { connectTimeoutMS: 10000}).then(async(client)=>{
    try{
        //configuring database
        const db= client.db()
        const collection=db.collection("media.files")
        const bucket= new GridFSBucket(db,{bucketName:"media"})

        app.post("/upload",upload.array("file"),async(req,res)=>{
            try{
                const index=req.files.length
                let indexForward=0;
                for(let i=0;i<req.files.length;i++){
                    const type=req.files[i].mimetype
                    
                    const readStream= new Readable()
                    readStream.push(req.files[i].buffer)
                    readStream.push(null)

                    if (type.startsWith('video/')){
                            
                            const image=await generateThumbnail(req.files[i].buffer)
                        
                        const uploadStream= bucket.openUploadStream(req.files[i].originalname,{
                            metadata:{ type: type, owner:"unknown@gmail.com",thumbnail:image}
                         })

                         readStream.pipe(uploadStream)
                         uploadStream.on("finish",()=>{
                             indexForward = indexForward+1;
                             if(index==indexForward){
                                 res.status(200).send({message:"Upload successful"})
                             }
                         })
                         uploadStream.on("error",()=>{
                             console.log("Error in file upload")
                             throw new Error("Something went wrong")
                         })
                    }else{
                        const uploadStream= bucket.openUploadStream(req.files[i].originalname,{
                            metadata:{ type: type, owner:"unknown@gmail.com" }
                         })
                         readStream.pipe(uploadStream)
                         uploadStream.on("finish",()=>{
                             indexForward = indexForward+1;
                             if(index==indexForward){
                                 res.status(200).send({message:"Upload successful"})
                             }
                         })
                         uploadStream.on("error",()=>{
                             console.log("Error in file upload")
                             throw new Error("Something went wrong")
                         })
                    }
                    
                }
                
            }catch(error){
                console.log(error)
                res.status(500).send({message:"Something went wrong in uploading"})
            }
        })

        app.get("/media",async(req,res)=>{
            try{
                const data= await collection.find({}).toArray()
                res.status(200).send({message:"Data fetched successfully",data:data})
            }catch(error){
                res.status(500).send({message:"Error in fetching data"})
            }
        })

        app.get("/media/:id",async(req,res)=>{
            try{
                const id=req.params.id
                const videoData= await collection.findOne({_id:new ObjectId(id)})
                const type=videoData.metadata.type.split("/")[0]

            if(videoData){
                if(type==="video"){
                    const rangeHeader= req.headers.range
                    
                    if(!rangeHeader){
                        // const stream = bucket.openDownloadStreamByName("img1.jpg")
                        //     stream.pipe(res);
                        res.status(500).send({message:"Problem in Range Header"})
                    }

                    const videoSize=await videoData.length;
                    const parts= rangeHeader.replace(/bytes=/,"").split("-")
                    const start= parseInt(parts[0],10);
                    const end= parts[1]? parseInt(parts[1],10): videoSize-1;
        
                    const chunksize=end- start+1;
                    const headers = {
                        'Content-Range': `bytes ${start}-${end}/${videoSize}`,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': chunksize,
                        'Content-Type': `video/* image/*`,
                    };
                    res.writeHead(206, headers);
                    try{
                        // console.log(videoData)
                            const stream= bucket.openDownloadStream(new ObjectId(id),{start,end})
                            stream.pipe(res);
                    
                    }catch(error){
                        console.log(error)
                        res.status(500).send({message:"Something went wrong"})
                    }
                    
                }else if(type=="image"){
                    try{
                            const stream = bucket.openDownloadStream(new ObjectId(id))
                            stream.pipe(res);
                        
                    }catch(error){
                        console.log(error)
                        res.status(500).send({message:"Something went wrong"})
                    }
                   
                }else if(type=="application"){
                    const headers = {
                        'Content-Type': `application/pdf`,
                        'Content-Disposition': `inline; filename="viewed.pdf"`
                    };
                    res.writeHead(206, headers);
                    try{
                            const stream= bucket.openDownloadStream(new ObjectId(id))
                            stream.pipe(res);
                    
                    }catch(error){
                        console.log(error)
                        res.status(500).send({message:"Something went wrong"})
                    }
                }
            }else{
                res.status(500).send({message:"No media with this ID"})
            }
            }catch(error){
                res.status(500).send({message:"Something went wrong"})
            }
        })
        app.delete("/media/:id",async(req,res)=>{
            try{
                const id=req.params.id
            const videoData= await collection.findOne({_id:new ObjectId(id)})
            const type=videoData.metadata.type.split("/")[0]
            if(videoData){
                await bucket.delete(videoData._id)
                res.status(200).send({message:'Media deleted successfully'})
            }else{
                res.status(404).send({message:'No media with this ID'})
            }
            }catch(error){
                res.status(400).send({message:error.message})
            }
        })

        
    }catch(error){
        console.log("Database connection error")
        console.log(error)
    }
})
app.get("/test",(req,res)=>{
    res.json("Everything is okay")
})
app.listen(port,()=>{
    console.log("Server is running")
})
module.exports= app