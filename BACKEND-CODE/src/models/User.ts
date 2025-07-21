import mongoose, { Schema, model } from 'mongoose';
import { IUser, UserRole } from '../types';

const userProfileSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  institution: {
    type: String,
    trim: true,
    maxlength: 200
  },
  course: {
    type: String,
    trim: true,
    maxlength: 100
  }
}, { _id: false });

const userPreferencesSchema = new Schema({
  emailNotifications: {
    type: Boolean,
    default: true
  },
  defaultRubric: {
    type: Schema.Types.ObjectId,
    ref: 'Rubric'
  }
}, { _id: false });

const userStatsSchema = new Schema({
  totalSubmissions: {
    type: Number,
    default: 0,
    min: 0
  },
  averageScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  lastActive: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const userSchema = new Schema<IUser>({
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Must be a valid email address'
    },
    index: true
  },
  role: {
    type: String,
    enum: ['student', 'instructor', 'admin'] as UserRole[],
    default: 'student'
  },
  profile: {
    type: userProfileSchema,
    required: true
  },
  preferences: {
    type: userPreferencesSchema,
    default: () => ({})
  },
  stats: {
    type: userStatsSchema,
    default: () => ({})
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      // Never return sensitive information
      return ret;
    }
  }
});

// Indexes for performance
userSchema.index({ firebaseUid: 1 });
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ 'stats.lastActive': -1 });

// Pre-save middleware
userSchema.pre('save', function(next) {
  // Update last active timestamp
  if (this.isModified() && !this.isModified('stats.lastActive')) {
    this.stats.lastActive = new Date();
  }
  
  // Ensure profile exists
  if (!this.profile) {
    this.profile = {
      name: this.email.split('@')[0], // Default name from email
      institution: '',
      course: ''
    };
  }
  
  next();
});

// Instance methods
userSchema.methods.updateStats = async function() {
  const Submission = mongoose.model('Submission');
  
  const submissionStats = await Submission.aggregate([
    { $match: { userId: this.firebaseUid } },
    {
      $group: {
        _id: null,
        totalSubmissions: { $sum: 1 },
        averageScore: { $avg: '$scores.total' }
      }
    }
  ]);
  
  if (submissionStats.length > 0) {
    this.stats.totalSubmissions = submissionStats[0].totalSubmissions || 0;
    this.stats.averageScore = submissionStats[0].averageScore || 0;
  }
  
  this.stats.lastActive = new Date();
  await this.save();
};

userSchema.methods.isInstructor = function(): boolean {
  return this.role === 'instructor' || this.role === 'admin';
};

userSchema.methods.isAdmin = function(): boolean {
  return this.role === 'admin';
};

userSchema.methods.canGradeSubmissions = function(): boolean {
  return this.role === 'instructor' || this.role === 'admin';
};

userSchema.methods.getDisplayName = function(): string {
  return this.profile.name || this.email.split('@')[0];
};

// Static methods
userSchema.statics.findByFirebaseUid = function(firebaseUid: string) {
  return this.findOne({ firebaseUid });
};

userSchema.statics.findByEmail = function(email: string) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findInstructors = function() {
  return this.find({ role: { $in: ['instructor', 'admin'] } });
};

userSchema.statics.findStudents = function() {
  return this.find({ role: 'student' });
};

userSchema.statics.getActiveUsers = function(days: number = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return this.find({
    'stats.lastActive': { $gte: cutoffDate }
  }).sort({ 'stats.lastActive': -1 });
};

userSchema.statics.getUserStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        averageSubmissions: { $avg: '$stats.totalSubmissions' },
        averageScore: { $avg: '$stats.averageScore' }
      }
    }
  ]);
  
  const result = {
    total: 0,
    students: 0,
    instructors: 0,
    admins: 0,
    averageSubmissions: 0,
    averageScore: 0
  };
  
  stats.forEach(stat => {
    result.total += stat.count;
    if (stat._id === 'student') result.students = stat.count;
    if (stat._id === 'instructor') result.instructors = stat.count;
    if (stat._id === 'admin') result.admins = stat.count;
    result.averageSubmissions += stat.averageSubmissions || 0;
    result.averageScore += stat.averageScore || 0;
  });
  
  // Average across all roles
  if (stats.length > 0) {
    result.averageSubmissions = result.averageSubmissions / stats.length;
    result.averageScore = result.averageScore / stats.length;
  }
  
  return result;
};

// Create or update user from Firebase token
userSchema.statics.createOrUpdateFromFirebase = async function(firebaseUser: {
  uid: string;
  email: string;
  name?: string;
}) {
  let user = await this.findOne({ firebaseUid: firebaseUser.uid });
  
  if (!user) {
    // Create new user
    user = new this({
      firebaseUid: firebaseUser.uid,
      email: firebaseUser.email,
      profile: {
        name: firebaseUser.name || firebaseUser.email.split('@')[0],
        institution: '',
        course: ''
      }
    });
  } else {
    // Update existing user
    user.email = firebaseUser.email;
    if (firebaseUser.name && firebaseUser.name !== user.profile.name) {
      user.profile.name = firebaseUser.name;
    }
    user.stats.lastActive = new Date();
  }
  
  await user.save();
  return user;
};

export const User = model<IUser>('User', userSchema); 