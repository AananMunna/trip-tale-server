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

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// console.log(process.env.STRIPE_SECRET_KEY)
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const usersCollection = client.db("tripTale").collection("users");
    const packagesCollection = client.db("tripTale").collection("packages");
    const bookingsCollection = client.db("tripTale").collection("bookings");
    const paymentsCollection = client.db("tripTale").collection("payments");

    // all post route here--------------------------------------------------------
    // stripe payment intent----------------------------------------------------
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount, // in cents: 7200 => 720000
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

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

    // booking api to book a package
    app.post("/bookings", async (req, res) => {
      const bookingData = req.body;
      try {
        const result = await bookingsCollection.insertOne(bookingData);
        res.send(result);
      } catch (err) {
        res
          .status(500)
          .send({ error: "Failed to book tour", details: err.message });
      }
    });

    // POST route to save payment history
    app.post("/payment-history", async (req, res) => {
      try {
        const paymentData = req.body;

        // Simple validation (you can add more)
        if (
          !paymentData.bookingId ||
          !paymentData.amount ||
          !paymentData.transactionId ||
          !paymentData.email
        ) {
          return res
            .status(400)
            .json({ message: "Missing required payment data" });
        }

        // Insert payment record into the collection
        const result = await paymentsCollection.insertOne({
          ...paymentData,
          createdAt: new Date(),
        });

        if (result.insertedId) {
          return res.status(201).json({
            message: "Payment history saved successfully",
            id: result.insertedId,
          });
        } else {
          return res
            .status(500)
            .json({ message: "Failed to save payment history" });
        }
      } catch (error) {
        console.error("Error saving payment history:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // all get route here ---------------------------------------------------------

    // get single user data with email
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email });
        if (user) {
          res.send(user);
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Server error", error });
      }
    });

    // GET /bookings?email=user@example.com
    app.get("/bookings", async (req, res) => {
      const email = req.query.email;
      const result = await bookingsCollection
        .find({ touristEmail: email })
        .toArray();
      res.send(result);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid booking ID." });
      }

      try {
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).json({ error: "Booking not found." });
        }

        res.status(200).json(booking);
      } catch (error) {
        console.error("Error fetching booking:", error);
        res.status(500).json({ error: "Internal server error." });
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

    //  Get all users with role = guide
    app.get("/users", async (req, res) => {
      const role = req.query.role;
      const query = role ? { role } : {};
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // get all payment history
    app.get("/payment-history", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).json({ message: "Email required" });

      try {
        const history = await paymentsCollection
          .find({ email })
          .sort({ date: -1 })
          .toArray();
        res.json(history);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // all delete router here------------------------------------------------------
    // DELETE /bookings/:id
    app.delete("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const result = await bookingsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // all patch route here------------------------------------------------------------
    app.patch("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = req.body; // e.g., { status: "confirmed" }

      try {
        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Booking not found" });
        }

        res.json({ message: "Booking updated successfully" });
      } catch (error) {
        console.error("Error updating booking:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // update user data
    app.patch("/users/:email", async (req, res) => {
      const email = req.params.email;
      const updatedData = req.body;

      const result = await usersCollection.updateOne(
        { email },
        { $set: updatedData }
      );

      res.send(result);
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
