const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.9c3fo4b.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.5yis0oo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

var admin = require("firebase-admin");

// 1. Read base64 string from environment
const serviceAccountJSON = Buffer.from(
  process.env.FIREBASE_SERVICE_KEY,
  "base64"
).toString("utf-8");

// 2. Parse it back to object
const serviceAccount = JSON.parse(serviceAccountJSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFireBaseToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;
  // console.log(authHeader);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).send({ message: "unauthorized access" });
  }

  const token = authHeader.split(" ")[1];
  // console.log('token in the middleware', token)
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
    // console.log(decoded);
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const verifyTokenEmail = (req, res, next) => {
  if (req.params.email !== req.decoded.email) {
    return res.status(403).message({ message: "forbidden access" });
  }
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const usersCollection = client.db("tripTale").collection("users");
    const packagesCollection = client.db("tripTale").collection("packages");

    // ⬇️ API to save or update user
    app.post("/users", async (req, res) => {
      const userData = req.body;
      const query = { email: userData.email };
      const updateDoc = {
        $set: {
          name: userData.name,
          photo: userData.photo,
          role: userData.role || "tourist",
          lastLogin: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      };

      const options = { upsert: true };
      try {
        const result = await usersCollection.updateOne(
          query,
          updateDoc,
          options
        );
        res.send({ success: true, result });
      } catch (error) {
        console.error("❌ Error saving user:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to save user", error });
      }
    });

    // Express route to get 3 random packages
    app.get("/packages/random", async (req, res) => {
      try {
        const result = await packagesCollection
          .aggregate([{ $sample: { size: 3 } }])
          .toArray();

        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch random packages" });
      }
    });

    // single package details route
    app.get("/packages/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const result = await packagesCollection.findOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Something went wrong" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("tripTale server is running.");
});

app.listen(port, () => {
  console.log(`tripTale server is running on port ${port}`);
});
